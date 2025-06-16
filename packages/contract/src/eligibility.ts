import { keccak256 } from "@sedaprotocol/overlay-ts-common";

export function createEligibilityHash(drId: string, chainId: string, contractAddr: string): Buffer {
	return Buffer.from(
		keccak256(
			Buffer.concat([
				Buffer.from("is_executor_eligible"),
				Buffer.from(drId),
				Buffer.from(chainId),
				Buffer.from(contractAddr),
			]),
		),
	);
}

export function createEligibilityMessageData(identityId: string, drId: string, signature: Buffer): string {
	return Buffer.from(`${identityId}:${drId}:${signature.toString("hex")}`).toString("base64");
}