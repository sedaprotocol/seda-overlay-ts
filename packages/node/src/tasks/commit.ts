import {
	createCommitMessageHash,
	createCommitment,
	createRevealBodyHash,
	createRevealMessageHash,
} from "@sedaprotocol/core-contract-schema/src/commit";
import { RevealStarted, type SedaChain, TransactionPriority } from "@sedaprotocol/overlay-ts-common";
import type { AlreadyCommitted, DataRequestExpired, DataRequestNotFound } from "@sedaprotocol/overlay-ts-common";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Result } from "true-myth";
import { type DataRequest, isDrInRevealStage } from "../models/data-request";
import type { ExecutionResult } from "../models/execution-result";
import type { IdentityPool } from "../models/identitiest-pool";

export async function commitDr(
	identityId: string,
	dataRequest: DataRequest,
	executionResult: ExecutionResult,
	identityPool: IdentityPool,
	sedaChain: SedaChain,
	appConfig: AppConfig,
): Promise<Result<Buffer, DataRequestExpired | AlreadyCommitted | RevealStarted | DataRequestNotFound | Error>> {
	// Fail safe, if the data request is in the reveal stage we can't commit and it shouldn't even try to
	if (isDrInRevealStage(dataRequest)) {
		return Result.err(new RevealStarted());
	}

	const traceId = `${dataRequest.id}_${identityId}`;

	const chainId = appConfig.sedaChain.chainId;
	const contractAddr = await sedaChain.getCoreContractAddress();

	logger.trace("Creating commit proof", {
		id: traceId,
	});

	const revealBodyHash = createRevealBodyHash(executionResult.revealBody);
	const revealMessageHash = createRevealMessageHash(revealBodyHash, chainId, contractAddr);
	const revealProof = identityPool.sign(identityId, revealMessageHash);
	if (revealProof.isErr) return Result.err(revealProof.error);

	const commitment = createCommitment(
		revealBodyHash,
		identityId,
		revealProof.value.toString("hex"),
		executionResult.stderr,
		executionResult.stdout,
	);
	const commitMessageHash = createCommitMessageHash(
		executionResult.revealBody.dr_id,
		BigInt(executionResult.revealBody.dr_block_height),
		commitment.toString("hex"),
		chainId,
		contractAddr,
	);
	const commitProof = identityPool.sign(identityId, commitMessageHash);
	if (commitProof.isErr) return Result.err(commitProof.error);

	logger.trace("Waiting for commit transaction to be processed", {
		id: traceId,
	});

	const commitResponse = await sedaChain.waitForSmartContractTransaction(
		{
			commit_data_result: {
				dr_id: dataRequest.id,
				commitment: commitment.toString("hex"),
				proof: commitProof.value.toString("hex"),
				public_key: identityId,
			},
		},
		TransactionPriority.LOW,
		undefined,
		undefined,
		undefined,
		traceId,
	);

	logger.trace("Commit transaction processed", {
		id: traceId,
	});

	if (commitResponse.isErr) {
		return Result.err(commitResponse.error);
	}

	return Result.ok(commitment);
}
