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

export function createUnstakeMessageSignatureHash(
	amount: bigint,
	chainId: string,
	contractAddr: string,
	sequence: bigint,
): Buffer {
	// Convert amount to 16 bytes (128 bits) in big-endian format
	const amountBytes = Buffer.alloc(16);
	amountBytes.writeBigUInt64BE(amount >> 64n, 0);
	amountBytes.writeBigUInt64BE(amount & ((1n << 64n) - 1n), 8);

	// Convert sequence to 16 bytes (128 bits) in big-endian format
	const sequenceBytes = Buffer.alloc(16);
	sequenceBytes.writeBigUInt64BE(sequence >> 64n, 0);
	sequenceBytes.writeBigUInt64BE(sequence & ((1n << 64n) - 1n), 8);

	// Concatenate all components in the same order as Rust implementation
	return keccak256(
		Buffer.concat([
			Buffer.from("unstake"),
			amountBytes,
			Buffer.from(chainId),
			Buffer.from(contractAddr),
			sequenceBytes,
		]),
	);
}

export function createWithdrawMessageSignatureHash(
	amount: bigint,
	chainId: string,
	contractAddr: string,
	sequence: bigint,
): Buffer {
	// Convert amount to 16 bytes (128 bits) in big-endian format
	const amountBytes = Buffer.alloc(16);
	amountBytes.writeBigUInt64BE(amount >> 64n, 0);
	amountBytes.writeBigUInt64BE(amount & ((1n << 64n) - 1n), 8);

	// Convert sequence to 16 bytes (128 bits) in big-endian format
	const sequenceBytes = Buffer.alloc(16);
	sequenceBytes.writeBigUInt64BE(sequence >> 64n, 0);
	sequenceBytes.writeBigUInt64BE(sequence & ((1n << 64n) - 1n), 8);

	// Concatenate all components in the same order as Rust implementation
	return keccak256(
		Buffer.concat([
			Buffer.from("withdraw"),
			amountBytes,
			Buffer.from(chainId),
			Buffer.from(contractAddr),
			sequenceBytes,
		]),
	);
}
