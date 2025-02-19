import { keccak256 as cosmosKeccak256 } from "@cosmjs/crypto";

export function keccak256(data: Buffer): Buffer {
	return Buffer.from(cosmosKeccak256(data));
}
