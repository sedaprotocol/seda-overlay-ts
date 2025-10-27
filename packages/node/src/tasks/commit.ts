import { MsgCommit } from "@seda-protocol/proto-messages/libs/proto-messages/gen/sedachain/core/v1/tx";
import {
	createCommitMessageHash,
	createCommitment,
	createRevealBodyHash,
	createRevealMessageHash,
} from "@sedaprotocol/core-contract-schema/src/commit";
import { RevealStarted, type SedaChain, TransactionPriority } from "@sedaprotocol/overlay-ts-common";
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

	logger.trace("Creating commit proof", {
		id: traceId,
	});

	const revealBodyHash = createRevealBodyHash(executionResult.revealBody);
	const revealMessageHash = createRevealMessageHash(revealBodyHash, chainId);
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
	);
	const commitProof = identityPool.sign(identityId, commitMessageHash);
	if (commitProof.isErr) return Result.err(commitProof.error);

	logger.trace("Waiting for commit transaction to be processed", {
		id: traceId,
	});

	const gasOptions: GasOptions | undefined = appConfig.node.gasEstimationsEnabled
		? { gas: Math.round(estimateGasForCommit(dataRequest) * appConfig.sedaChain.gasAdjustmentFactor) }
		: undefined;

	const commitMsg = {
		typeUrl: "/sedachain.core.v1.MsgCommit",
		value: MsgCommit.fromPartial({
			drID: dataRequest.id,
			commit: commitment.toString("hex"),
			publicKey: identityId,
			proof: commitProof.value.toString("hex"),
		}),
	};
	const commitResponse = await sedaChain.queueCosmosMessage(commitMsg, TransactionPriority.LOW, gasOptions);

	logger.trace("Commit transaction processed", {
		id: traceId,
	});

	if (commitResponse.isErr) {
		return Result.err(commitResponse.error);
	}

	return Result.ok(commitment);
}
