import { describe, expect, it } from "bun:test";
import { vrfProve } from "@sedaprotocol/overlay-ts-common/src/services/vrf";
import { createCommitMessageHash, createCommitment, createRevealBodyHash, createRevealMessageHash } from "./commit";
import type { RevealBody } from "./reveal";

describe("createRevealBodyHash", () => {
	it("should create the correct hash", () => {
		const revealBody: RevealBody = {
			dr_id: "3aa91e148d735de527a185f5ff36238dc4edae93605a1e0bb09962a2f64a818f",
			dr_block_height: 1,
			exit_code: 0,
			gas_used: 1n,
			reveal: Buffer.from("ccb1f717aa77602faf03a594761a36956b1c4cf44c6b336d1db57da799b331b8", "hex"),
			proxy_public_keys: ["030123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"],
		};
		const hash = createRevealBodyHash(revealBody);

		expect(hash.toString("hex")).toBe("6f1fcb82763ff3697546b945398c76e995acba40b9fa80c12b2ae27f990a4761");
	});
});

describe("createCommitmentHash", () => {
	it("should create the correct hash", () => {
		const revealBody: RevealBody = {
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

		expect(hash.toString("hex")).toBe("5cd42fbed0f93a8ad51098c3c3354203acbfd59ba67f0b1304a8db4938f4cba9");
	});
});

describe("createCommitmentMessageSignatureHash", () => {
	it("should create the correct hash", () => {
		const messageHash = createCommitMessageHash(
			"3aa91e148d735de527a185f5ff36238dc4edae93605a1e0bb09962a2f64a818f",
			1n,
			"5cd42fbed0f93a8ad51098c3c3354203acbfd59ba67f0b1304a8db4938f4cba9",
			"seda_test",
		);

		expect(messageHash.toString("hex")).toBe("cea5308a78283be4d02bae4db034680995815d7371caa2f034397cfa15baf554");
	});
});

describe("commit/reveal", () => {
	it("should create the correct commit and reveal messages", () => {
		const revealBody: RevealBody = {
			dr_id: "3aa91e148d735de527a185f5ff36238dc4edae93605a1e0bb09962a2f64a818f",
			dr_block_height: 1,
			exit_code: 0,
			gas_used: 1n,
			reveal: Buffer.from("ccb1f717aa77602faf03a594761a36956b1c4cf44c6b336d1db57da799b331b8", "hex"),
			proxy_public_keys: ["030123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"],
		};

		const signingKey = "2bd806c97f0e00af1a1fc3328fa763a9269723c8db8fac4f93af71db186d6e90";
		const publicKey = "039997a497d964fc1a62885b05a51166a65a90df00492c8d7cf61d6accf54803be";
		const chainId = "seda_test";
		const stderr: string[] = [];
		const stdout: string[] = [];

		// Step 1: Create the reveal body hash
		const revealBodyHash = createRevealBodyHash(revealBody);
		expect(revealBodyHash.toString("hex")).toBe("6f1fcb82763ff3697546b945398c76e995acba40b9fa80c12b2ae27f990a4761");

		// Step 2: Create the hash used as part of the reveal message
		const revealMessageHash = createRevealMessageHash(revealBodyHash, chainId);
		expect(revealMessageHash.toString("hex")).toBe("e4c4ce71f72a0b69c0b0cf06eed6de1cdae2998a9e5d387824ae7f7ebe93f6db");

		// Step 3: Prove reveal message hash
		const revealProof = vrfProve(Buffer.from(signingKey, "hex"), revealMessageHash);
		expect(revealProof.toString("hex")).toBe(
			"027dba0119599c4f13818db05ba3cb62c0d1eafcb00df4c76437a5bf31a79670de7a3604f228d24c36cc41d991711eb739dbc8054e597b37402a0c45ad123cd0bb214716a55d013eba5776052a72fe1335",
		);

		// Step 4: Create Reveal Message
		// const revealMessage = {
		// 	revealBody: revealBody,
		// 	publicKey: publicKey,
		// 	proof: revealProof.toString("hex"),
		// 	stderr: stderr,
		// 	stdout: stdout,
		// };

		// Step 5: Commitment hash
		const commitment = createCommitment(revealBodyHash, publicKey, revealProof.toString("hex"), stderr, stdout);
		expect(commitment.toString("hex")).toBe("85cc1478cc060f15edcbd7a89fd61b7d6056d243eddbcef261fd6f05a4054cc9");

		// Step 6: Create commit message hash
		const commitMessageHash = createCommitMessageHash(
			revealBody.dr_id,
			BigInt(revealBody.dr_block_height),
			commitment.toString("hex"),
			chainId,
		);
		expect(commitMessageHash.toString("hex")).toBe("45d1e862dd1a929bc91befe81e1db3c70ad19bca9c32fcfffdd5e2812c2ddb55");

		// Step 7: Prove commit message hash
		const commitProof = vrfProve(Buffer.from(signingKey, "hex"), commitMessageHash);
		expect(commitProof.toString("hex")).toBe(
			"037af31e9a2b73049123eb3cf2d6cfb0a0aa221673fbcbcdbd3f6a10333f0e47cf09dc53fb1c35d2b573feb5840dec8d830d378b874d8fea644da20c71ebb0598236936aca56704730363cc7708245f32b",
		);

		// Step 8: Create Commit Message
		// const commitMessage = {
		// 	drId: revealBody.dr_id,
		// 	commitment: commitment.toString("hex"),
		// 	publicKey: publicKey,
		// 	proof: commitProof.toString("hex"),
		// };
	});
});
