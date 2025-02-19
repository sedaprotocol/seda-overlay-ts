import { keccak256 } from "@sedaprotocol/overlay-ts-common";
import type { RevealBody as RevealBodyFromContract } from "./result-schema/execute";

export interface RevealBody extends Omit<RevealBodyFromContract, "gas_used" | "reveal"> {
	gas_used: bigint;
	reveal: Buffer;
}

export function createRevealMessageSignatureHash(
	drId: string,
	chainId: string,
	coreContractAddress: string,
	drHeight: bigint,
	revealBodyHash: Buffer,
) {
	// Convert bigint to 8 bytes in big-endian format
	const drHeightBytes = Buffer.alloc(8);
	drHeightBytes.writeBigUInt64BE(drHeight);

	// Concatenate all the components in the same order as the Rust implementation
	return keccak256(
		Buffer.concat([
			Buffer.from("reveal_data_result"),
			Buffer.from(drId),
			drHeightBytes,
			revealBodyHash,
			Buffer.from(chainId),
			Buffer.from(coreContractAddress),
		]),
	);
}
