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
			"seda1mzdhwvvh22wrt07w59wxyd58822qavwkx5lcej7aqfkpqqlhaqfsuj50sf",
		);

		expect(messageHash.toString("hex")).toBe("19d5058188ace3f0bff7511dba75f1ff17d2138c532bae63b711fc60a5756564");
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
		const contractAddr = "seda1mzdhwvvh22wrt07w59wxyd58822qavwkx5lcej7aqfkpqqlhaqfsuj50sf";
		const stderr: string[] = [];
		const stdout: string[] = [];

		// Step 1: Create the reveal body hash
		const revealBodyHash = createRevealBodyHash(revealBody);
		expect(revealBodyHash.toString("hex")).toBe("6f1fcb82763ff3697546b945398c76e995acba40b9fa80c12b2ae27f990a4761");

		// Step 2: Create the hash used as part of the reveal message
		const revealMessageHash = createRevealMessageHash(revealBodyHash, chainId, contractAddr);
		expect(revealMessageHash.toString("hex")).toBe("d964307485fdd72aa259e49d7465cc62bf3ac1bec77d796464c9b4c0ccde35f1");

		// Step 3: Prove reveal message hash
		const revealProof = vrfProve(Buffer.from(signingKey, "hex"), revealMessageHash);
		expect(revealProof.toString("hex")).toBe(
			"021b15623b1c54f9a3fc9c7de066732ddf90851c9a4a6997d1b68b387e95b6786843a05d256fb86f4bcb267f02fa168628ec89a24cccd2429b5a36760af575fb5ac6dca2e4beb4c53adae7953437b77f98",
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
		expect(commitment.toString("hex")).toBe("3c5f027221b68115e903218b21580e8eac4dc75400bcbb675a9b644353f2f8a8");

		// Step 6: Create commit message hash
		const commitMessageHash = createCommitMessageHash(
			revealBody.dr_id,
			BigInt(revealBody.dr_block_height),
			commitment.toString("hex"),
			chainId,
			contractAddr,
		);
		expect(commitMessageHash.toString("hex")).toBe("8d339d64555776870046a41f1a5154c402672f5f5aa3c9c5a30dc298f20be8d8");

		// Step 7: Prove commit message hash
		const commitProof = vrfProve(Buffer.from(signingKey, "hex"), commitMessageHash);
		expect(commitProof.toString("hex")).toBe(
			"02b0a7baca1f08bb1de047dfda2c0c58818a565019a0aed9894430d072badc52ca07970536f97279ebd3567b3a7dcd147b212fe4c3b7de9cdee5105fdbc0807dbbeab8cacaedb2376949d6c1e4bb84a4fe",
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
