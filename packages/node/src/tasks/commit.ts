import {
	createCommitMessageHash,
	createCommitment,
	createRevealBodyHash,
	createRevealMessageHash,
} from "@sedaprotocol/core-contract-schema/src/commit";
import { RevealStarted, customMetrics, type SedaChain, TransactionPriority } from "@sedaprotocol/overlay-ts-common";
import type { AlreadyCommitted, DataRequestExpired, DataRequestNotFound } from "@sedaprotocol/overlay-ts-common";
import type { GasOptions } from "@sedaprotocol/overlay-ts-common/src/seda/gas-options";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Result } from "true-myth";
import { type DataRequest, isDrInRevealStage } from "../models/data-request";
import type { ExecutionResult } from "../models/execution-result";
import type { IdentityPool } from "../models/identitiest-pool";
import { estimateGasForCommit } from "../services/gas";

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
	if (revealProof.isErr) {
		// CRITICAL-005: Identity Signing Failure - Missing keys for reveal proof
		customMetrics.identitySigningFailures.add(1, {
			type: 'reveal_proof_signing',
			identity_id: identityId,
			dr_id: dataRequest.id,
			error_type: revealProof.error.constructor.name,
		});
		
		return Result.err(revealProof.error);
	}

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
	if (commitProof.isErr) {
		// CRITICAL-005: Identity Signing Failure - Missing keys for commit proof
		customMetrics.identitySigningFailures.add(1, {
			type: 'commit_proof_signing',
			identity_id: identityId,
			dr_id: dataRequest.id,
			error_type: commitProof.error.constructor.name,
		});
		
		return Result.err(commitProof.error);
	}

	logger.trace("Waiting for commit transaction to be processed", {
		id: traceId,
	});

	const gasOptions: GasOptions | undefined = appConfig.node.gasEstimationsEnabled
		? { gas: Math.round(estimateGasForCommit(dataRequest) * appConfig.sedaChain.gasAdjustmentFactor) }
		: undefined;

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
		gasOptions,
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
