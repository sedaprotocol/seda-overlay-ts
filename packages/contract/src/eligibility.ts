import { keccak256 } from "@sedaprotocol/overlay-ts-common";

export function createEligibilityHash(drId: string, chainId: string): Buffer {
	return Buffer.from(
		keccak256(Buffer.concat([Buffer.from("is_executor_eligible"), Buffer.from(drId), Buffer.from(chainId)])),
	);
}

export function createEligibilityMessageData(identityId: string, drId: string, signature: Buffer): string {
	return Buffer.from(`${identityId}:${drId}:${signature.toString("hex")}`).toString("base64");
}
