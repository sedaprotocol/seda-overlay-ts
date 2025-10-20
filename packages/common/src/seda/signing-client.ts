import { type JsonObject, SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { toUtf8 } from "@cosmjs/encoding";
import {
	type JsonRpcRequest,
	type JsonRpcSuccessResponse,
	isJsonRpcErrorResponse,
	parseJsonRpcResponse,
} from "@cosmjs/json-rpc";
import { type DeliverTxResponse, type SequenceResponse, createProtobufRpcClient } from "@cosmjs/stargate";
import { Comet38Client, HttpClient, type HttpEndpoint } from "@cosmjs/tendermint-rpc";
import { sedachain } from "@seda-protocol/proto-messages";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { QueryClientImpl } from "cosmjs-types/cosmwasm/wasm/v1/query";
import { MsgExecuteContractResponse } from "cosmjs-types/cosmwasm/wasm/v1/tx";
import makeFetchCookie from "fetch-cookie";
import { JSONParse, JSONStringify } from "json-with-bigint";
import { Maybe, Result } from "true-myth";
import { tryAsync } from "../services/try-async";
import type { ISigner } from "./signer";

type Mutable<T> = { -readonly [P in keyof T]: T[P] };

export class SedaSigningCosmWasmClient extends SigningCosmWasmClient {
	accountInfo: Maybe<Mutable<SequenceResponse>> = Maybe.nothing();
	cacheSequenceNumber = true;

	/**
	 * Exact same as queryContractSmart, but uses the big int encoding for numbers that are too big for the JSON standard.
	 * This is needed because the contract returns numbers that are too big for the JSON standard.
	 *
	 * @param address - The address of the smart contract to query
	 * @param queryMsg - The query message to send to the smart contract
	 */
	async queryContractSmartBigInt(address: string, queryMsg: JsonObject) {
		try {
			const stringified = JSONStringify(queryMsg);
			const request = { address: address, queryData: toUtf8(stringified) };
			const cometClient = this.forceGetQueryClient();
			const rpc = createProtobufRpcClient(cometClient);
			const queryClient = new QueryClientImpl(rpc);

			const response = await queryClient.SmartContractState(request);
			const responseText = Buffer.from(response.data).toString("utf-8");

			return JSONParse(responseText);
		} catch (error) {
			if (error instanceof Error) {
				if (error.message.startsWith("not found: contract")) {
					throw new Error(`No contract found at address "${address}"`);
				}

				throw error;
			}

			throw error;
		}
	}

	incrementSequence(): boolean {
		if (this.accountInfo.isJust) {
			this.accountInfo.value.sequence += 1;
			return true;
		}
		return false;
	}

	async getSequence(address: string): Promise<SequenceResponse> {
		if (this.cacheSequenceNumber && this.accountInfo.isJust) {
			return this.accountInfo.value;
		}

		const result = await super.getSequence(address);
		this.accountInfo = Maybe.just(result);

		return result;
	}

	async broadcastTx(tx: Uint8Array, timeoutMs?: number, pollIntervalMs?: number): Promise<DeliverTxResponse> {
		try {
			const response = await super.broadcastTx(tx, timeoutMs, pollIntervalMs);
			this.incrementSequence();
			return response;
		} catch (error) {
			const errorMsg = `${error}`;
			if (errorMsg.includes("incorrect account sequence")) {
				logger.warn("Resetting sequence number");
				this.accountInfo = Maybe.nothing();
			}
			throw error;
		}
	}

	async broadcastTxSync(tx: Uint8Array): Promise<string> {
		try {
			const response = await super.broadcastTxSync(tx);
			this.incrementSequence();
			return response;
		} catch (error) {
			const errorMsg = `${error}`;
			if (errorMsg.includes("incorrect account sequence")) {
				logger.warn("Resetting sequence number");
				this.accountInfo = Maybe.nothing();
			}
			throw error;
		}
	}
}

const fetchCookie = makeFetchCookie(fetch);

interface SedaHttpClientOptions {
	followRedirects: boolean;
	redirectTtlMs: number;
}

class SedaHttpClient extends HttpClient {
	private originalUrl: string;
	private redirectExpiresAt = 0;

	constructor(
		url: string | HttpEndpoint,
		private options: SedaHttpClientOptions,
	) {
		super(url);
		this.originalUrl = this.url;
	}

	async execute(request: JsonRpcRequest): Promise<JsonRpcSuccessResponse> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};

		if (this.redirectExpiresAt && this.redirectExpiresAt < Date.now()) {
			// @ts-expect-error - this is a private property that we need to override
			this.url = this.originalUrl;
			this.redirectExpiresAt = 0;

			logger.debug(`Reset redirect url, url is now ${this.url}`);
		}

		const res = await fetchCookie(this.url, {
			credentials: "include",
			method: "POST",
			body: request ? JSON.stringify(request) : undefined,
			headers,
		});

		if (res.redirected && this.options.followRedirects) {
			// @ts-expect-error - this is a private property that we need to override
			this.url = res.url;
			this.redirectExpiresAt = Date.now() + this.options.redirectTtlMs;

			logger.debug(`Redirecting to ${res.url}, expires at ${new Date(this.redirectExpiresAt).toISOString()}`);
		}

		if (res.status >= 400) {
			throw new Error(`Bad status on response: ${res.status}`);
		}

		const raw = await res.json();

		const jsonResponse = parseJsonRpcResponse(raw);

		if (isJsonRpcErrorResponse(jsonResponse)) {
			throw new Error(JSON.stringify(jsonResponse.error));
		}

		return jsonResponse;
	}
}

export async function createSigningClient(
	signer: ISigner,
	cacheSequenceNumber: boolean,
	httpClientOptions: SedaHttpClientOptions,
): Promise<Result<{ client: SedaSigningCosmWasmClient; address: string }, Error>> {
	const httpClient = new SedaHttpClient(signer.getEndpoint(), httpClientOptions);
	const tendermintRpc = await tryAsync(async () => await Comet38Client.create(httpClient));

	if (tendermintRpc.isErr) {
		return Result.err(new Error(`Could not create tendermint rpc: ${tendermintRpc.error}`));
	}

	// @ts-expect-error - ignore protected constructor error
	const signingClientResult: SedaSigningCosmWasmClient = new SedaSigningCosmWasmClient(
		tendermintRpc.value,
		signer.getSigner(),
		{},
	);

	signingClientResult.cacheSequenceNumber = cacheSequenceNumber;
	signingClientResult.registry.register(MsgExecuteContractResponse.typeUrl, MsgExecuteContractResponse);
	signingClientResult.registry.register("/sedachain.core.v1.MsgStake", sedachain.core.v1.MsgStake);
	signingClientResult.registry.register("/sedachain.core.v1.MsgStakeResponse", sedachain.core.v1.MsgStakeResponse);
	signingClientResult.registry.register("/sedachain.core.v1.MsgUnstake", sedachain.core.v1.MsgUnstake);
	signingClientResult.registry.register("/sedachain.core.v1.MsgUnstakeResponse", sedachain.core.v1.MsgUnstakeResponse);
	signingClientResult.registry.register("/sedachain.core.v1.MsgWithdraw", sedachain.core.v1.MsgWithdraw);
	signingClientResult.registry.register(
		"/sedachain.core.v1.MsgWithdrawResponse",
		sedachain.core.v1.MsgWithdrawResponse,
	);

	return Result.ok({
		client: signingClientResult,
		address: signer.getAddress(),
	});
}
