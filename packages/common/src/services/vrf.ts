import { Secp256k1Vrf } from "@seda-protocol/secp256k1-vrf";

export function vrfProve(privateKey: Buffer, message: Buffer): Buffer {
	const vrf = new Secp256k1Vrf();
	return Buffer.from(vrf.prove(privateKey, message));
}
