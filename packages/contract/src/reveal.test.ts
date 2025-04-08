import { describe, expect, it } from "bun:test";
import { createCommitment, createRevealBodyHash } from "./commit";
import { createRevealMessageSignatureHash } from "./reveal";

describe("createRevealMessageSignatureHash", () => {
	it("should create the correct hash", () => {
		const revealBody = {
			dr_id: "3aa91e148d735de527a185f5ff36238dc4edae93605a1e0bb09962a2f64a818f",
			dr_block_height: 1,
			exit_code: 0,
			gas_used: 1n,
			reveal: Buffer.from("ccb1f717aa77602faf03a594761a36956b1c4cf44c6b336d1db57da799b331b8", "hex"),
			proxy_public_keys: ["030123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"],
		};
		const revealBodyHash = createRevealBodyHash(revealBody);
		const hash = createCommitment(
			revealBodyHash,
			"0300006a74b5d88b7abeae92d636168a20192d082c686cf9226667f6012e4e74e4",
			"03aa10102500eab6fe3a1fabbecf5e62246ce5d328b666799804dfd78ea1396426a92e774a04e01fc72d453364b15300366d72354f7f3c450d6257e51e0779097a414b2ab1a7aba381d5947da193624a05",
			[],
			[],
		);
		const messageHash = createRevealMessageSignatureHash(
			"835793852eca9e6af588baca6611bb99fee61653e7306f5e9487b206e31639d2",
			"seda_test",
			"seda1mzdhwvvh22wrt07w59wxyd58822qavwkx5lcej7aqfkpqqlhaqfsuj50sf",
			1n,
			hash,
		);

		expect(messageHash.toString("hex")).toBe("22e61819a5cfb4f0035f8b9b5be1b5cb9e9aa550404be387ff1ebe7a845d23fa");
	});
});
