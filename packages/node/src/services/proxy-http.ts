import { Secp256k1, Secp256k1Signature } from "@cosmjs/crypto";
import type { HttpFetchResponse, ProxyHttpFetchAction } from "@seda-protocol/vm";
import { keccak256 } from "@sedaprotocol/overlay-ts-common";
import { VRF } from "vrf-ts";

export function generateProxyHttpProofHash(drId: string, chainId: string, contractAddr: string): Buffer {
	return keccak256(
		Buffer.concat([
			Buffer.from("is_executor_eligible"),
			Buffer.from(drId),
			Buffer.from(chainId),
			Buffer.from(contractAddr),
		]),
	);
}

export async function createProxyHttpProof(
	identityPrivateKey: Buffer,
	drId: string,
	chainId: string,
	contractAddr: string,
): Promise<string> {
	const messageHash = generateProxyHttpProofHash(drId, chainId, contractAddr);
	const keyPair = await Secp256k1.makeKeypair(identityPrivateKey);
	const publicKey = Buffer.from(Secp256k1.compressPubkey(keyPair.pubkey));
	const vrf = new VRF("secp256k1");
	const signature = vrf.prove(identityPrivateKey, messageHash);

	const proof = `${publicKey.toString("hex")}:${drId}:${signature.toString("hex")}`;

	return Buffer.from(proof).toString("base64");
}

export async function verifyProxyHttpResponse(
	rawSignature: Buffer,
	publicKey: Buffer,
	httpAction: ProxyHttpFetchAction,
	response: HttpFetchResponse,
): Promise<boolean> {
	try {
		// Get request body or empty array if undefined
		const requestBody = Buffer.from(httpAction.options.body || new Uint8Array());

		// Calculate all the required hashes
		const requestUrlHash = keccak256(Buffer.from(httpAction.url));
		const requestMethodHash = keccak256(Buffer.from(httpAction.options.method.toUpperCase()));
		const requestBodyHash = keccak256(Buffer.from(requestBody));
		const responseBodyHash = keccak256(Buffer.from(response.data.bytes));

		// Concatenate all hashes
		const messageBytes = Buffer.concat([requestUrlHash, requestMethodHash, requestBodyHash, responseBodyHash]);

		// Calculate final message hash
		const messageHash = keccak256(messageBytes);
		const signature = Secp256k1Signature.fromFixedLength(rawSignature);

		// Verify the signature
		return Secp256k1.verifySignature(signature, messageHash, publicKey);
	} catch (_error) {
		return false;
	}
}
