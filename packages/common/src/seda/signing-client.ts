import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import {
	type JsonRpcRequest,
	type JsonRpcSuccessResponse,
	isJsonRpcErrorResponse,
	parseJsonRpcResponse,
} from "@cosmjs/json-rpc";
import type { EncodeObject } from "@cosmjs/proto-signing";
import type { SequenceResponse, StdFee } from "@cosmjs/stargate";
import { Comet38Client, HttpClient } from "@cosmjs/tendermint-rpc";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import Cookies from "cookie";
// import { tryAsync } from "@seda-protocol/utils";
import { MsgExecuteContractResponse } from "cosmjs-types/cosmwasm/wasm/v1/tx";
import { Maybe, Result } from "true-myth";
import type { ISigner } from "./signer";

type Mutable<T> = { -readonly [P in keyof T]: T[P] };

export class SedaSigningCosmWasmClient extends SigningCosmWasmClient {
	accountInfo: Maybe<Mutable<SequenceResponse>> = Maybe.nothing();

	cacheSequenceNumber = true;

	async getSequence(address: string): Promise<SequenceResponse> {
		if (this.cacheSequenceNumber && this.accountInfo.isJust) {
			this.accountInfo.value.sequence += 1;
			return this.accountInfo.value;
		}

		const result = await super.getSequence(address);
		this.accountInfo = Maybe.just(result);

		return result;
	}

	async signAndBroadcastSync(
		signerAddress: string,
		messages: readonly EncodeObject[],
		fee: StdFee | "auto" | number,
		memo?: string,
		timeoutHeight?: bigint,
	): Promise<string> {
		try {
			const response = await super.signAndBroadcastSync(signerAddress, messages, fee, memo, timeoutHeight);
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

const COOKIE_OPTION_KEYS = ["expires", "path", "samesite"];

/**
 * Parses an array of cookie strings and returns a Map of cookie key-value pairs.
 * Filters out standard cookie options like expires, path, and samesite.
 *
 * @param cookies - Array of cookie strings to parse
 * @returns Map containing cookie names as keys and their values
 */
function getRpcCookies(cookies: string[]): string {
	const cookiesResult: string[] = [];

	for (const cookie of cookies) {
		const unfilteredCookies = Cookies.parse(cookie);

		const filteredCookies = Object.entries(unfilteredCookies).filter(([key]) => {
			return !COOKIE_OPTION_KEYS.includes(key.toLowerCase());
		});

		for (const [key, value] of filteredCookies) {
			cookiesResult.push(Cookies.serialize(key, value ?? ""));
		}
	}

	return cookiesResult.join(";");
}

class SedaHttpClient extends HttpClient {
	private cookies: Maybe<string> = Maybe.nothing();

	async execute(request: JsonRpcRequest): Promise<JsonRpcSuccessResponse> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};

		if (this.cookies.isJust) {
			headers.Cookies = this.cookies.value;
		}

		const res = await fetch(this.url, {
			credentials: "include",
			method: "POST",
			body: request ? JSON.stringify(request) : undefined,
			headers,
		});

		if (res.status >= 400) {
			throw new Error(`Bad status on response: ${res.status}`);
		}

		const cookies = getRpcCookies(res.headers.getSetCookie());
		this.cookies = Maybe.just(cookies);
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
