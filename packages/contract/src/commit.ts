import { keccak256 } from "@sedaprotocol/overlay-ts-common";
import type { RevealBody } from "./reveal";

export function createCommitmentHash(revealBody: RevealBody): Buffer {
	const revealHash = keccak256(revealBody.reveal);
	const exitCodeBuffer = Buffer.from([revealBody.exit_code]);
	const gasUsedBuffer = Buffer.alloc(8);
	gasUsedBuffer.writeBigUInt64BE(revealBody.gas_used);

	const publicKeysHash = keccak256(
		Buffer.concat(revealBody.proxy_public_keys.map((publicKey) => keccak256(Buffer.from(publicKey)))),
	);

	return Buffer.from(
		keccak256(
			Buffer.concat([
				Buffer.from(revealBody.id, "hex"),
				Buffer.from(revealBody.salt),
				exitCodeBuffer,
				gasUsedBuffer,
				revealHash,
				publicKeysHash,
			]),
		),
	);
}

export function createCommitmentMessageSignatureHash(
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
