import { describe, expect, it } from "bun:test";
import { createCommitmentHash } from "./commit";
import { createRevealMessageSignatureHash } from "./reveal";

describe("createCommitmentMessageSignatureHash", () => {
	it("should create the correct hash", () => {
		const hash = createCommitmentHash({
			exit_code: 0,
			gas_used: 0n,
			id: "835793852eca9e6af588baca6611bb99fee61653e7306f5e9487b206e31639d2",
			proxy_public_keys: [],
			reveal: Buffer.from("1a192fabce13988b84994d4296e6cdc418d55e2f1d7f942188d4040b94fc57ac", "hex"),
			salt: "9c0257114eb9399a2985f8e75dad7600c5d89fe3824ffa99ec1c3eb8bf3b0501",
		});

		const messageHash = createRevealMessageSignatureHash(
			"835793852eca9e6af588baca6611bb99fee61653e7306f5e9487b206e31639d2",
			"seda_test",
			"seda1mzdhwvvh22wrt07w59wxyd58822qavwkx5lcej7aqfkpqqlhaqfsuj50sf",
			1n,
			hash,
		);

		expect(messageHash.toString("hex")).toBe("acedf3d655d869a9216d8d761f0750baa92559356b770c22d1384cdc0529e0c6");
	});
});
