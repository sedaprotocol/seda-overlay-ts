import { createRevealBodyHash, createRevealMessageHash } from "@sedaprotocol/core-contract-schema/src/commit";
// import { createRevealMessageSignatureHash } from "@sedaprotocol/core-contract-schema";
import { type SmartContractMessage, TransactionPriority } from "@sedaprotocol/overlay-ts-common";
import {
	type AlreadyRevealed,
	type DataRequestExpired,
	type RevealMismatch,
	SedaChainService,
} from "@sedaprotocol/overlay-ts-common";
import type { GasOptions } from "@sedaprotocol/overlay-ts-common/src/seda/gas-options";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Effect, Option } from "effect";
import type { DataRequest } from "../models/data-request";
import type { ExecutionResult } from "../models/execution-result";
import type { IdentityPool } from "../models/identitiest-pool";
import { estimateGasForReveal } from "../services/gas";

export class EnchancedRevealError {
	constructor(
		public error: RevealMismatch | AlreadyRevealed | DataRequestExpired | Error,
		public commitmentHash: Buffer,
	) {}
}

export function createRevealTransaction(
	identityId: string,
	dataRequest: DataRequest,
	executionResult: ExecutionResult,
	identityPool: IdentityPool,
	appConfig: AppConfig,
): Effect.Effect<
	{ revealBodyHash: Buffer; gasOptions: Option.Option<GasOptions>; tx: SmartContractMessage },
	EnchancedRevealError,
	SedaChainService
> {
	return Effect.gen(function* () {
		const sedaChain = yield* SedaChainService;

		const contractAddr = yield* sedaChain
			.getCoreContractAddress()
			.pipe(Effect.mapError((error) => new EnchancedRevealError(error, Buffer.from([]))));

		const revealBodyHash = createRevealBodyHash(executionResult.revealBody);
		const revealMessageHash = createRevealMessageHash(revealBodyHash, appConfig.sedaChain.chainId, contractAddr);
		const revealProof = identityPool.sign(identityId, revealMessageHash);
		if (revealProof.isErr) return yield* Effect.fail(new EnchancedRevealError(revealProof.error, revealBodyHash));

		const gasOptions: Option.Option<GasOptions> = appConfig.node.gasEstimationsEnabled
			? Option.some({
					gas: Math.round(estimateGasForReveal(dataRequest, executionResult) * appConfig.sedaChain.gasAdjustmentFactor),
				})
			: Option.none();

		return {
			revealBodyHash,
			gasOptions,
			tx: {
				message: {
					reveal_data_result: {
						public_key: identityId,
						proof: revealProof.value.toString("hex"),
						reveal_body: {
							...executionResult.revealBody,
							gas_used: Number(executionResult.revealBody.gas_used.toString()),
							reveal: executionResult.revealBody.reveal.toString("base64"),
						},
						stderr: executionResult.stderr,
						stdout: executionResult.stdout,
					},
				},
				attachedAttoSeda: Option.none(),
			},
		};
	});
}

export function revealDr(
	identityId: string,
	dataRequest: DataRequest,
	executionResult: ExecutionResult,
	identityPool: IdentityPool,
	appConfig: AppConfig,
) {
	return Effect.gen(function* () {
		const sedaChain = yield* SedaChainService;
		const traceId = `${dataRequest.id}_${identityId}`;

		logger.trace("Creating reveal proof", {
			id: traceId,
		});

		const revealTransaction = yield* createRevealTransaction(
			identityId,
			dataRequest,
			executionResult,
			identityPool,
			appConfig,
		);

		logger.trace("Waiting for reveal transaction to be processed", {
			id: traceId,
		});

		yield* sedaChain
			.queueSmartContractMessage(
				`${traceId}_reveal`,
				[revealTransaction.tx],
				TransactionPriority.HIGH,
				sedaChain.getSignerInfo(Option.none()),
				revealTransaction.gasOptions,
			)
			.pipe(Effect.mapError((error) => new EnchancedRevealError(error, revealTransaction.revealBodyHash)));

		logger.trace("Reveal transaction processed", {
			id: traceId,
		});
	});
}
