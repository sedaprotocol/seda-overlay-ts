import {
	createCommitMessageHash,
	createCommitment,
	createRevealBodyHash,
	createRevealMessageHash,
} from "@sedaprotocol/core-contract-schema/src/commit";
import {
	RevealStarted,
	type SedaChain,
	TransactionPriority,
	UnknownError,
	promiseResultToEffect,
	resultToEffect,
	tryAsyncEffect,
} from "@sedaprotocol/overlay-ts-common";

import type { AlreadyCommitted, DataRequestExpired, AlreadyRevealed, RevealMismatch } from "@sedaprotocol/overlay-ts-common/src/seda/errors";
import type { GasOptions } from "@sedaprotocol/overlay-ts-common/src/seda/gas-options";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Effect } from "effect";
import { type DataRequest, isDrInRevealStage } from "../models/data-request";
import type { ExecutionResult } from "../models/execution-result";
import type { IdentityPool } from "../models/identitiest-pool";
import { estimateGasForCommit } from "../services/gas";

export const commitDr = (
	identityId: string,
	dataRequest: DataRequest,
	executionResult: ExecutionResult,
	identityPool: IdentityPool,
	sedaChain: SedaChain,
	appConfig: AppConfig,
): Effect.Effect<Buffer, RevealStarted | DataRequestExpired | AlreadyCommitted | AlreadyRevealed | RevealMismatch | UnknownError> =>
	Effect.gen(function* () {
		// Fail safe, if the data request is in the reveal stage we can't commit and it shouldn't even try to
		if (isDrInRevealStage(dataRequest)) {
			yield* Effect.fail(new RevealStarted());
		}

		const traceId = `${dataRequest.id}_${identityId}`;

		const chainId = appConfig.sedaChain.chainId;
		const contractAddr = yield* tryAsyncEffect(sedaChain.getCoreContractAddress());

		logger.trace("Creating commit proof", {
			id: traceId,
		});

		const revealBodyHash = createRevealBodyHash(executionResult.revealBody);
		const revealMessageHash = createRevealMessageHash(revealBodyHash, chainId, contractAddr);
		const revealProof = yield* resultToEffect(identityPool.sign(identityId, revealMessageHash));

		const commitment = createCommitment(
			revealBodyHash,
			identityId,
			revealProof.toString("hex"),
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

		const commitProof = yield* resultToEffect(identityPool.sign(identityId, commitMessageHash));

		logger.trace("Waiting for commit transaction to be processed", {
			id: traceId,
		});

		const gasOptions: GasOptions | undefined = appConfig.node.gasEstimationsEnabled
			? { gas: Math.round(estimateGasForCommit(dataRequest) * appConfig.sedaChain.gasAdjustmentFactor) }
			: undefined;

		yield* promiseResultToEffect(
			sedaChain.waitForSmartContractTransaction(
				{
					commit_data_result: {
						dr_id: dataRequest.id,
						commitment: commitment.toString("hex"),
						proof: commitProof.toString("hex"),
						public_key: identityId,
					},
				},
				TransactionPriority.LOW,
				undefined,
				gasOptions,
				undefined,
				traceId,
			),
		);

		logger.trace("Commit transaction processed", {
			id: traceId,
		});

		return commitment;
	}).pipe(
		Effect.mapError((error) => {
			if (error instanceof Error) {
				return new UnknownError(error.message);
			}
			return error;
		}),
		Effect.withSpan("commit-dr"),
	);
