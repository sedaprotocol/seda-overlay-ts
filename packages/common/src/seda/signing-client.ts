import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import {
	type JsonRpcRequest,
	type JsonRpcSuccessResponse,
	isJsonRpcErrorResponse,
	parseJsonRpcResponse,
} from "@cosmjs/json-rpc";
import type { DeliverTxResponse, SequenceResponse } from "@cosmjs/stargate";
import { Comet38Client, HttpClient } from "@cosmjs/tendermint-rpc";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { MsgExecuteContractResponse } from "cosmjs-types/cosmwasm/wasm/v1/tx";
import makeFetchCookie from "fetch-cookie";
import { Maybe, Result } from "true-myth";
import type { ISigner } from "./signer";

type Mutable<T> = { -readonly [P in keyof T]: T[P] };

export class SedaSigningCosmWasmClient extends SigningCosmWasmClient {
	accountInfo: Maybe<Mutable<SequenceResponse>> = Maybe.nothing();
	cacheSequenceNumber = true;

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

class SedaHttpClient extends HttpClient {
	async execute(request: JsonRpcRequest): Promise<JsonRpcSuccessResponse> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};

		const res = await fetchCookie(this.url, {
			credentials: "include",
			method: "POST",
			body: request ? JSON.stringify(request) : undefined,
			headers,
		});

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
): Promise<Result<{ client: SedaSigningCosmWasmClient; address: string }, unknown>> {
	const httpClient = new SedaHttpClient(signer.getEndpoint());
	const tendermintRpc = await Comet38Client.create(httpClient);

	// @ts-ignore
	const signingClientResult: SedaSigningCosmWasmClient = new SedaSigningCosmWasmClient(
		tendermintRpc,
		signer.getSigner(),
		{},
	);

	signingClientResult.cacheSequenceNumber = cacheSequenceNumber;
	signingClientResult.registry.register(MsgExecuteContractResponse.typeUrl, MsgExecuteContractResponse);

	return Result.ok({
		client: signingClientResult,
		address: signer.getAddress(),
	});
}
