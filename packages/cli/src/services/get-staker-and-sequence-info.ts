import type { GetStakerAndSeqResponse } from "@sedaprotocol/core-contract-schema";
import type { SedaChain } from "@sedaprotocol/overlay-ts-common";
import { Maybe, Result } from "true-myth";

interface StakerAndSeq extends Omit<GetStakerAndSeqResponse, "staker" | "seq"> {
	seq: bigint;
	staker: Maybe<Exclude<GetStakerAndSeqResponse["staker"], null | undefined>>;
}

export async function getStakerAndSequenceInfo(
	identityId: string,
	sedaChain: SedaChain,
): Promise<Result<StakerAndSeq, Error>> {
	const response = await sedaChain.queryContractSmart<GetStakerAndSeqResponse>({
		get_staker_and_seq: {
			public_key: identityId,
		},
	});

	if (response.isErr) return Result.err(new Error(`getIdentitySequence failed: ${response.error}`));

	return response.map((value) => ({
		...value,
		seq: BigInt(value.seq),
		staker: Maybe.of(value.staker),
	}));
}
