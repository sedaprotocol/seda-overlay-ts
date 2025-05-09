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
import type { SedaChain } from "@sedaprotocol/overlay-ts-common";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import isLocalhostIp from "is-localhost-ip";
import { Maybe, Result } from "true-myth";
import { createProxyHttpProof, verifyProxyHttpResponse } from "./services/proxy-http";

type Options = {
	dataRequestId: string;
	coreContractAddress: string;
	chainId: string;
	identityPrivateKey: Buffer;
	gasPrice: bigint;
	appConfig: AppConfig;
};

export class OverlayVmAdapter extends DataRequestVmAdapter {
	private dataProxyRpcQueryClient: sedachain.data_proxy.v1.QueryClientImpl;
	public usePublicKeys: string[] = [];

	constructor(
		private options: Options,
		sedaChain: SedaChain,
	) {
		super({});

		this.dataProxyRpcQueryClient = new sedachain.data_proxy.v1.QueryClientImpl(sedaChain.getProtobufRpcClient());
	}

	async httpFetch(action: HttpFetchAction): Promise<PromiseStatus<HttpFetchResponse>> {
		const url = trySync(() => new URL(action.url));
		if (url.isErr) return HttpFetchResponse.createRejectedPromise(`${action.url} is not a valid URL`);

		const isLocalIp = await isLocalhostIp(url.value.hostname);

		if (isLocalIp && this.options.appConfig.node.blockLocalhost) {
			return HttpFetchResponse.createRejectedPromise(`${action.url} is not allowed`);
		}

		return super.httpFetch(action);
	}

	async getProxyHttpFetchGasCost(action: ProxyHttpFetchAction): Promise<Result<bigint, Error>> {
		const clonedAction = structuredClone(action);
		clonedAction.options.method = HttpFetchMethod.Options;

		// OPTIONS requests should not have a body
		clonedAction.options.body = undefined;

		const httpFetchResult = await tryAsync(
			this.httpFetch({
				options: clonedAction.options,
				url: clonedAction.url,
				type: "http-fetch-action",
			}),
		);

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
		const clonedAction = structuredClone(action);
		clonedAction.options.headers["x-seda-proof"] = await createProxyHttpProof(
			this.options.identityPrivateKey,
			this.options.dataRequestId,
			this.options.chainId,
			this.options.coreContractAddress,
		);

		const rawHttpResponse = await this.httpFetch({
			...clonedAction,
			type: "http-fetch-action",
		});

		const httpResponse = HttpFetchResponse.fromPromise(rawHttpResponse);
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
		const isValidSignature = await verifyProxyHttpResponse(signature, publicKey, action, httpResponse);

		if (!isValidSignature) {
			return HttpFetchResponse.createRejectedPromise("Invalid signature");
		}

		this.usePublicKeys.push(publicKeyRaw.value);
		return rawHttpResponse;
	}
}
