import { type JsonObject, SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { toUtf8 } from "@cosmjs/encoding";
import {
	type JsonRpcRequest,
	type JsonRpcSuccessResponse,
	isJsonRpcErrorResponse,
	parseJsonRpcResponse,
} from "@cosmjs/json-rpc";
import { type DeliverTxResponse, type SequenceResponse, createProtobufRpcClient } from "@cosmjs/stargate";
import { Comet38Client, HttpClient } from "@cosmjs/tendermint-rpc";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { QueryClientImpl } from "cosmjs-types/cosmwasm/wasm/v1/query";
import { MsgExecuteContractResponse } from "cosmjs-types/cosmwasm/wasm/v1/tx";
import makeFetchCookie from "fetch-cookie";
import { JSONParse, JSONStringify } from "json-with-bigint";
import { Maybe, Result } from "true-myth";
import type { ISigner } from "./signer";

type Mutable<T> = { -readonly [P in keyof T]: T[P] };

export class SedaSigningCosmWasmClient extends SigningCosmWasmClient {
	accountInfo: Maybe<Mutable<SequenceResponse>> = Maybe.nothing();
	cacheSequenceNumber = true;
	
	// 🚀 SEQUENCE FIX: Add synchronization to prevent race conditions
	private sequenceUpdateLock: boolean = false;
	private sequenceResetCount: number = 0;

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
			logger.debug(`🔢 Sequence incremented to ${this.accountInfo.value.sequence}`);
			return true;
		}
		return false;
	}

	// 🚀 SEQUENCE FIX: Enhanced sequence management with race condition protection
	async getSequence(address: string): Promise<SequenceResponse> {
		// If we're in the middle of a sequence update, wait for it to complete
		if (this.sequenceUpdateLock) {
			logger.debug("🔒 Waiting for sequence update lock to be released");
			await new Promise(resolve => setTimeout(resolve, 10));
			return this.getSequence(address); // Retry after lock is released
		}

		if (this.cacheSequenceNumber && this.accountInfo.isJust) {
			logger.debug(`🔢 Using cached sequence: ${this.accountInfo.value.sequence}`);
			return this.accountInfo.value;
		}

		logger.debug("🔄 Fetching fresh sequence from chain");
		const result = await super.getSequence(address);
		this.accountInfo = Maybe.just(result);
		logger.info(`🔢 Fresh sequence fetched: ${result.sequence}`);

		return result;
	}

	// 🚀 SEQUENCE FIX: Synchronized sequence reset to prevent inconsistent state
	async resetSequenceNumber(reason: string): Promise<void> {
		if (this.sequenceUpdateLock) {
			logger.debug("🔒 Sequence reset already in progress, skipping duplicate reset");
			return;
		}

		this.sequenceUpdateLock = true;
		this.sequenceResetCount++;
		
		try {
			logger.warn(`🔄 Resetting sequence number (reason: ${reason}, reset #${this.sequenceResetCount})`);
			this.accountInfo = Maybe.nothing();
			
			// Small delay to prevent rapid reset loops
			await new Promise(resolve => setTimeout(resolve, 50));
		} finally {
			this.sequenceUpdateLock = false;
		}
	}

	async broadcastTx(tx: Uint8Array, timeoutMs?: number, pollIntervalMs?: number): Promise<DeliverTxResponse> {
		try {
			const response = await super.broadcastTx(tx, timeoutMs, pollIntervalMs);
			this.incrementSequence();
			return response;
		} catch (error) {
			const errorMsg = `${error}`;
			if (errorMsg.includes("incorrect account sequence")) {
				await this.resetSequenceNumber("broadcastTx error");
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
				await this.resetSequenceNumber("broadcastTxSync error");
			}
			throw error;
		}
	}

	// 🚀 SEQUENCE FIX: Add method to get sequence statistics for debugging
	getSequenceStats() {
		return {
			hasCachedSequence: this.accountInfo.isJust,
			currentSequence: this.accountInfo.isJust ? this.accountInfo.value.sequence : null,
			resetCount: this.sequenceResetCount,
			isLocked: this.sequenceUpdateLock,
		};
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
