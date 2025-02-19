import { keccak256 } from "@sedaprotocol/overlay-ts-common";
import type { Maybe } from "true-myth";

export type { StakerAndSeq as GetStakerAndSeqResponse } from "./result-schema/response_to_get_staker_and_seq";

export function createStakeMessageSignatureHash(
	chainId: string,
	contractAddr: string,
	sequence: bigint,
	memo: Maybe<Buffer>,
): Buffer {
	// First hash the memo if it exists
	const memoHash = keccak256(memo.unwrapOr(Buffer.alloc(0)));

	// Convert sequence to 16 bytes (128 bits) in big-endian format
	const sequenceBytes = Buffer.alloc(16);
	sequenceBytes.writeBigUInt64BE(sequence >> 64n, 0);
	sequenceBytes.writeBigUInt64BE(sequence & ((1n << 64n) - 1n), 8);

	// Concatenate all components in the same order as Rust implementation
	return keccak256(
		Buffer.concat([Buffer.from("stake"), memoHash, Buffer.from(chainId), Buffer.from(contractAddr), sequenceBytes]),
	);
}
