import type { Staker } from "@seda-protocol/proto-messages/libs/proto-messages/gen/sedachain/core/v1/core";
import { tryAsync } from "@seda-protocol/utils";
import type { SedaChain } from "@sedaprotocol/overlay-ts-common";
import { Maybe, Result } from "true-myth";

export interface StakerAndSeq {
	seq: bigint;
	staker: Maybe<Staker>;
}

export async function getStakerAndSequenceInfo(
	identityId: string,
	sedaChain: SedaChain,
): Promise<Result<StakerAndSeq, Error>> {
	const response = await tryAsync(sedaChain.getCoreQueryClient().StakerAndSeq({ publicKey: identityId }));

	if (response.isErr) return Result.err(new Error(`getIdentitySequence failed: ${response.error}`));

	return response.map((value) => ({
		...value,
		seq: value.sequenceNum,
		staker: Maybe.of(value.staker),
	}));
}
