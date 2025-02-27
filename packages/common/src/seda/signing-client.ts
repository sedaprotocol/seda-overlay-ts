import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import type { EncodeObject } from "@cosmjs/proto-signing";
import type { SequenceResponse, StdFee } from "@cosmjs/stargate";
import { connectComet } from "@cosmjs/tendermint-rpc";
import { logger } from "@sedaprotocol/overlay-ts-logger";
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
				logger.debug("Resetting sequence number");
				this.accountInfo = Maybe.nothing();
			}

			throw error;
		}
	}
}

export async function createSigningClient(
	signer: ISigner,
	cacheSequenceNumber: boolean,
): Promise<Result<{ client: SedaSigningCosmWasmClient; address: string }, unknown>> {
	// TODO: Cleanup
	const tendermintRpc = await connectComet(signer.getEndpoint());
	// @ts-ignore
	const signingClientResult: SedaSigningCosmWasmClient = new SedaSigningCosmWasmClient(
		tendermintRpc,
		signer.getSigner(),
		{},
	);

	signingClientResult.cacheSequenceNumber = cacheSequenceNumber;

	//const cometClient = await (0, tendermint_rpc_1.connectComet)(endpoint);
	// return SigningCosmWasmClient.createWithSigner(cometClient, signer, options);

	// const signingClientResult = await tryAsync(async () =>
	// 	SedaSigningCosmWasmClient.connectWithSigner(signer.getEndpoint(), signer.getSigner()),
	// );

	// if (signingClientResult.isErr) {
	// 	return Result.err(signingClientResult.error);
	// }

	signingClientResult.registry.register(MsgExecuteContractResponse.typeUrl, MsgExecuteContractResponse);

	return Result.ok({
		client: signingClientResult,
		address: signer.getAddress(),
	});
}
