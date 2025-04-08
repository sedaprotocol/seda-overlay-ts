import { keccak256 } from "@sedaprotocol/overlay-ts-common";
import type { RevealBody } from "./reveal";

export function createRevealBodyHash(revealBody: RevealBody): Buffer {
	const drBlockHeightBuffer = Buffer.alloc(8);
	drBlockHeightBuffer.writeBigUInt64BE(BigInt(revealBody.dr_block_height));
	const gasUsedBuffer = Buffer.alloc(8);
	gasUsedBuffer.writeBigUInt64BE(BigInt(revealBody.gas_used));

	const publicKeysHash = keccak256(
		Buffer.concat(revealBody.proxy_public_keys.map((publicKey) => keccak256(Buffer.from(publicKey)))),
	);

	return Buffer.from(
		keccak256(
			Buffer.concat([
				Buffer.from(revealBody.dr_id, "hex"),
				drBlockHeightBuffer,
				Buffer.from([revealBody.exit_code]),
				gasUsedBuffer,
				keccak256(revealBody.reveal),
				publicKeysHash,
			]),
		),
	);
}

export function createRevealMessageHash(revealBodyHash: Buffer, chainId: string, contractAddr: string): Buffer {
	return Buffer.from(
		keccak256(
			Buffer.concat([
				Buffer.from("reveal_data_result"),
				revealBodyHash,
				Buffer.from(chainId),
				Buffer.from(contractAddr),
			]),
		),
	);
}

export function createCommitment(
	revealBodyHash: Buffer,
	publicKey: string,
	proof: string,
	stderr: string[],
	stdout: string[],
): Buffer {
	return Buffer.from(
		keccak256(
			Buffer.concat([
				Buffer.from("reveal_message"),
				revealBodyHash,
				Buffer.from(publicKey),
				Buffer.from(proof),
				Buffer.from(stderr.join("")),
				Buffer.from(stdout.join("")),
			]),
		),
	);
}

export function createCommitMessageHash(
	dataRequestId: string,
	dataRequestHeight: bigint,
	commitment: string,
	chainId: string,
	coreContractAddress: string,
): Buffer {
	const heightBuffer = Buffer.alloc(8);
	heightBuffer.writeBigUInt64BE(dataRequestHeight);

	return Buffer.from(
		keccak256(
			Buffer.concat([
				Buffer.from("commit_data_result"),
				Buffer.from(dataRequestId),
				heightBuffer,
				Buffer.from(commitment),
				Buffer.from(chainId),
				Buffer.from(coreContractAddress),
			]),
		),
	);
}
