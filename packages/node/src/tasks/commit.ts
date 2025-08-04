import {
	createCommitMessageHash,
	createCommitment,
	createRevealBodyHash,
	createRevealMessageHash,
} from "@sedaprotocol/core-contract-schema/src/commit";
import {
	RevealStarted,
	SedaChainService,
	type SmartContractMessage,
	TransactionPriority,
} from "@sedaprotocol/overlay-ts-common";
import type { GasOptions } from "@sedaprotocol/overlay-ts-common/src/seda/gas-options";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Effect, Option } from "effect";
import { type DataRequest, isDrInRevealStage } from "../models/data-request";
import type { ExecutionResult } from "../models/execution-result";
import type { IdentityPool } from "../models/identitiest-pool";
import { estimateGasForCommit } from "../services/gas";

export function createCommitTransaction(
	identityId: string,
	dataRequest: DataRequest,
	executionResult: ExecutionResult,
	identityPool: IdentityPool,
	appConfig: AppConfig,
): Effect.Effect<
	{ commitment: Buffer; gasOptions: Option.Option<GasOptions>; tx: SmartContractMessage },
	Error,
	SedaChainService
> {
	return Effect.gen(function* () {
		const sedaChain = yield* SedaChainService;

		if (isDrInRevealStage(dataRequest)) {
			// Fail safe, if the data request is in the reveal stage we can't commit and it shouldn't even try to
			return yield* Effect.fail(new RevealStarted());
		}

		const chainId = appConfig.sedaChain.chainId;
		const contractAddr = yield* sedaChain.getCoreContractAddress();

		const revealBodyHash = createRevealBodyHash(executionResult.revealBody);
		const revealMessageHash = createRevealMessageHash(revealBodyHash, chainId, contractAddr);
		const revealProof = identityPool.sign(identityId, revealMessageHash);
		if (revealProof.isErr) return yield* Effect.fail(revealProof.error);

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
		if (commitProof.isErr) return yield* Effect.fail(commitProof.error);

		const gasOptions: Option.Option<GasOptions> = appConfig.node.gasEstimationsEnabled
			? Option.some({ gas: Math.round(estimateGasForCommit(dataRequest) * appConfig.sedaChain.gasAdjustmentFactor) })
			: Option.none();

		return {
			commitment,
			gasOptions,
			tx: {
				message: {
					commit_data_result: {
						dr_id: dataRequest.id,
						commitment: commitment.toString("hex"),
						proof: commitProof.value.toString("hex"),
						public_key: identityId,
					},
				},
				attachedAttoSeda: Option.none(),
			},
		};
	});
}

export function commitDr(
	identityId: string,
	dataRequest: DataRequest,
	executionResult: ExecutionResult,
	identityPool: IdentityPool,
	appConfig: AppConfig,
) {
	return Effect.gen(function* () {
		const sedaChain = yield* SedaChainService;

		const traceId = `${dataRequest.id}_${identityId}`;

		logger.trace("Creating commit proof", {
			id: traceId,
		});

		const commitTransaction = yield* createCommitTransaction(
			identityId,
			dataRequest,
			executionResult,
			identityPool,
			appConfig,
		);

		logger.trace("Waiting for commit transaction to be processed", {
			id: traceId,
		});

		yield* sedaChain.queueSmartContractMessage(
			`${traceId}_commit`,
			[commitTransaction.tx],
			TransactionPriority.LOW,
			sedaChain.getSignerInfo(Option.none()),
			commitTransaction.gasOptions,
		);

		logger.trace("Commit transaction processed", {
			id: traceId,
		});

		return commitTransaction.commitment;
	});
}
