import { sedachain } from "@seda-protocol/proto-messages";
import { tryAsync, trySync } from "@seda-protocol/utils";
import {
	DataRequestVmAdapter,
	type HttpFetchAction,
	HttpFetchMethod,
	HttpFetchResponse,
	type PromiseStatus,
	type ProxyHttpFetchAction,
} from "@seda-protocol/vm";
import { type SedaChain, sleep } from "@sedaprotocol/overlay-ts-common";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import isLocalhostIp from "is-localhost-ip";
import { Maybe, Result } from "true-myth";
import { createProxyHttpProof, verifyProxyHttpResponse } from "./services/proxy-http";

type Options = {
	dataRequestId: string;
	/**
	 * The height at which the identity was eligible for execution. It can be greater
	 * than the height at which it became eligible. We need this for data-proxy calls
	 * so they can know if their RPC is up to date.
	 */
	eligibilityHeight: bigint;
	coreContractAddress: string;
	chainId: string;
	identityPrivateKey: Buffer;
	gasPrice: bigint;
	appConfig: AppConfig;
	totalHttpTimeLimit: number;
};

const MAX_PROXY_HTTP_ATTEMPTS = 2;
type RetryDelay = (attempt: number) => number;

export class OverlayVmAdapter extends DataRequestVmAdapter {
	private dataProxyRpcQueryClient: sedachain.data_proxy.v1.QueryClientImpl;
	public usedProxyPublicKeys: string[] = [];

	constructor(
		private options: Options,
		sedaChain: SedaChain,
		private traceId: string,
	) {
		super({
			totalHttpTimeLimit: options.totalHttpTimeLimit,
		});

		this.dataProxyRpcQueryClient = new sedachain.data_proxy.v1.QueryClientImpl(sedaChain.getProtobufRpcClient());
	}

	async httpFetch(action: HttpFetchAction): Promise<PromiseStatus<HttpFetchResponse>> {
		logger.trace("HTTP fetch", {
			id: this.traceId,
		});

		const url = trySync(() => new URL(action.url));
		if (url.isErr) return HttpFetchResponse.createRejectedPromise(`${action.url} is not a valid URL`);

		logger.trace("HTTP fectch checking if localhost", {
			id: this.traceId,
		});

		const isLocalIp = await isLocalhostIp(url.value.hostname);

		if (isLocalIp && this.options.appConfig.node.blockLocalhost) {
			return HttpFetchResponse.createRejectedPromise(`${action.url} is not allowed`);
		}

		logger.trace("HTTP fetch making request", {
			id: this.traceId,
		});

		const result = await super.httpFetch(action);

		logger.trace("HTTP fetch result", {
			id: this.traceId,
		});

		return result;
	}

	async getProxyHttpFetchGasCost(action: ProxyHttpFetchAction): Promise<Result<bigint, Error>> {
		const clonedAction = structuredClone(action);
		clonedAction.options.method = HttpFetchMethod.Options;

		// OPTIONS requests should not have a body
		clonedAction.options.body = undefined;

		logger.trace("Getting proxy HTTP fetch gas cost", {
			id: this.traceId,
		});

		const httpFetchResult = await tryAsync(
			this.httpFetch({
				options: clonedAction.options,
				url: clonedAction.url,
				type: "http-fetch-action",
			}),
		);

		logger.trace("Proxy HTTP fetch gas cost result", {
			id: this.traceId,
		});

		if (httpFetchResult.isErr) return Result.err(httpFetchResult.error);
		const httpResponse = HttpFetchResponse.fromPromise(httpFetchResult.value);

		if (httpResponse.data.status === 0) {
			return Result.err(new Error(Buffer.from(httpResponse.data.bytes).toString()));
		}

		const publicKey = Maybe.of(httpResponse.data.headers["x-seda-publickey"]);
		if (publicKey.isNothing) {
			return Result.err(
				new Error(
					`Header x-seda-publickey was missing in the response headers \n response: ${Buffer.from(httpResponse.data.bytes).toString()}`,
				),
			);
		}

		const dataProxyRegistryResponse = (
			await tryAsync(
				this.dataProxyRpcQueryClient.DataProxyConfig({
					pubKey: publicKey.value,
				}),
			)
		).map((v) => Maybe.of(v.config));

		if (dataProxyRegistryResponse.isErr) return Result.err(dataProxyRegistryResponse.error);
		if (dataProxyRegistryResponse.value.isNothing)
			return Result.err(new Error(`No proxy details found for public key ${publicKey}`));

		const proxyFee = Maybe.of(dataProxyRegistryResponse.value.value.fee);
		if (proxyFee.isNothing) return Result.err(new Error(`No fee was set for proxy ${publicKey}`));

		const proxyCost = BigInt(proxyFee.value.amount);
		const proxyGasCost = proxyCost / this.options.gasPrice;

		return Result.ok(proxyGasCost);
	}

	async proxyHttpFetch(action: ProxyHttpFetchAction): Promise<PromiseStatus<HttpFetchResponse>> {
		logger.trace("Proxy HTTP fetch creating proof", {
			id: this.traceId,
		});

		const clonedAction = structuredClone(action);
		clonedAction.options.headers["x-seda-blockheight"] = this.options.eligibilityHeight.toString();
		clonedAction.options.headers["x-seda-proof"] = await createProxyHttpProof(
			this.options.identityPrivateKey,
			this.options.dataRequestId,
			this.options.chainId,
			this.options.coreContractAddress,
		);

		logger.trace("Proxy HTTP fetch with retry", {
			id: this.traceId,
		});

		const rawHttpResponse = await this.fetchWithRetry(
			{
				...clonedAction,
				type: "http-fetch-action",
			},
			MAX_PROXY_HTTP_ATTEMPTS,
		);

		logger.trace("Proxy HTTP fetch result", {
			id: this.traceId,
		});

		const httpResponse = HttpFetchResponse.fromPromise(rawHttpResponse);
		if (!isOkStatus(httpResponse.data.status)) {
			const bodyText = Buffer.from(httpResponse.data.bytes).toString("utf-8");
			return HttpFetchResponse.createRejectedPromise(
				`Proxy HTTP fetch failed with status ${httpResponse.data.status}. Body: ${bodyText}`,
			);
		}

		const signatureRaw = Maybe.of(httpResponse.data.headers["x-seda-signature"]);
		const publicKeyRaw = Maybe.of(httpResponse.data.headers["x-seda-publickey"]);

		if (signatureRaw.isNothing) {
			const bodyText = Buffer.from(httpResponse.data.bytes).toString("utf-8");
			return HttpFetchResponse.createRejectedPromise(`Header x-seda-signature was not available. Body: ${bodyText}`);
		}

		if (publicKeyRaw.isNothing) {
			const bodyText = Buffer.from(httpResponse.data.bytes).toString("utf-8");
			return HttpFetchResponse.createRejectedPromise(`Header x-seda-publickey was not available. Body: ${bodyText}`);
		}

		// Verify the signature:
		const signature = Buffer.from(signatureRaw.value, "hex");
		const publicKey = Buffer.from(action.public_key ?? publicKeyRaw.value, "hex");

		logger.trace("Proxy HTTP fetch verifying signature", {
			id: this.traceId,
		});

		const isValidSignature = await verifyProxyHttpResponse(signature, publicKey, action, httpResponse);

		logger.trace("Proxy HTTP fetch signature verified", {
			id: this.traceId,
		});

		if (!isValidSignature) {
			return HttpFetchResponse.createRejectedPromise("Invalid proxy signature");
		}

		this.usedProxyPublicKeys.push(publicKeyRaw.value);
		return rawHttpResponse;
	}

	/**
	 * Wraps the httpFetch method with basic retry logic. It will retry the request up to maxAttempts times.
	 * If the request succeeds, it will return the result.
	 * If the request fails before maxAttempts, it will try again.
	 * If the request fails after maxAttempts, it will return the last result.
	 *
	 * It will always attempt the request at least once, even if maxAttempts is a non-positive number.
	 * Optionally takes a retry delay function. By default it will wait 1 second between attempts.
	 */
	async fetchWithRetry(
		action: HttpFetchAction,
		maxAttempts: number,
		retryDelay: RetryDelay = (_attempt) => 1000,
	): Promise<PromiseStatus<HttpFetchResponse>> {
		let attempts = 0;
		let result: PromiseStatus<HttpFetchResponse>;

		do {
			result = await this.httpFetch(action);
			const httpResponse = HttpFetchResponse.fromPromise(result);

			if (isOkStatus(httpResponse.data.status)) return result;

			attempts++;

			const delay = retryDelay(attempts);
			if (delay > 0) {
				await sleep(delay);
			}
		} while (attempts < maxAttempts);

		return result;
	}
}

function isOkStatus(status: number): boolean {
	return status >= 200 && status < 300;
}
