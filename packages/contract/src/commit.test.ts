import { describe, expect, it } from "bun:test";
import { createCommitmentHash, createCommitmentMessageSignatureHash } from "./commit";

describe("createCommitmentHash", () => {
	it("should create the correct hash", () => {
		const hash = createCommitmentHash({
			exit_code: 0,
			gas_used: 0n,
			id: "835793852eca9e6af588baca6611bb99fee61653e7306f5e9487b206e31639d2",
			proxy_public_keys: [],
			reveal: Buffer.from("1a192fabce13988b84994d4296e6cdc418d55e2f1d7f942188d4040b94fc57ac", "hex"),
			salt: "9c0257114eb9399a2985f8e75dad7600c5d89fe3824ffa99ec1c3eb8bf3b0501",
		});

		expect(hash.toString("hex")).toBe("894dd8fa6be6b49dee0eab3df8408a4cb1fb5fcaa9bd1b851147efd7aa07ec1f");
	});
});

describe("createCommitmentMessageSignatureHash", () => {
	it("should create the correct hash", () => {
		const messageHash = createCommitmentMessageSignatureHash(
			"c1eada0eb326055dbda2331de47704279b7efdf1bdd73262ede12b844adc1977",
			1n,
			"30c57f91e77fd6a66617107af4830b757008e4a1b2d69a26c53f26656781d797",
			"seda_test",
			"seda1mzdhwvvh22wrt07w59wxyd58822qavwkx5lcej7aqfkpqqlhaqfsuj50sf",
		);

		expect(messageHash.toString("hex")).toBe("2de2397d143adffe2a37629bd34863beb616efbce18615bb9e42eca9a8f360c3");
	});
});
