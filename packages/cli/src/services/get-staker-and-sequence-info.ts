import type { GetStakerAndSeqResponse } from "@sedaprotocol/core-contract-schema";
import { SedaChainService } from "@sedaprotocol/overlay-ts-common";
import { Effect, Option } from "effect";

export interface StakerAndSeq extends Omit<GetStakerAndSeqResponse, "staker" | "seq"> {
	seq: bigint;
	staker: Option.Option<Exclude<GetStakerAndSeqResponse["staker"], null | undefined>>;
}

export function getStakerAndSequenceInfo(identityId: string): Effect.Effect<StakerAndSeq, Error, SedaChainService> {
	return Effect.gen(function* () {
		const sedaChain = yield* SedaChainService;

		const response = yield* sedaChain
			.queryContractSmart<GetStakerAndSeqResponse>({
				get_staker_and_seq: {
					public_key: identityId,
				},
			})
			.pipe(Effect.mapError((e) => new Error(`getIdentitySequence failed: ${e}`)));

		return {
			...response,
			seq: BigInt(response.seq),
			staker: Option.fromNullable(response.staker),
		};
	}).pipe(Effect.withSpan("getStakerAndSequenceInfo"));
}
