import { createRevealBodyHash, createRevealMessageHash } from "@sedaprotocol/core-contract-schema/src/commit";
// import { createRevealMessageSignatureHash } from "@sedaprotocol/core-contract-schema";
import { type SedaChain, TransactionPriority } from "@sedaprotocol/overlay-ts-common";
import type { AlreadyRevealed, DataRequestExpired, RevealMismatch } from "@sedaprotocol/overlay-ts-common";
import type { GasOptions } from "@sedaprotocol/overlay-ts-common/src/seda/gas-options";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Result, type Unit } from "true-myth";
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

export async function revealDr(
	identityId: string,
	dataRequest: DataRequest,
	executionResult: ExecutionResult,
	identityPool: IdentityPool,
	sedaChain: SedaChain,
	appConfig: AppConfig,
): Promise<Result<Unit, EnchancedRevealError>> {
	const traceId = `${dataRequest.id}_${identityId}`;

	logger.trace("Creating reveal proof", {
		id: traceId,
	});

	const revealBodyHash = createRevealBodyHash(executionResult.revealBody);
	const revealMessageHash = createRevealMessageHash(revealBodyHash, appConfig.sedaChain.chainId);
	const revealProof = identityPool.sign(identityId, revealMessageHash);
	if (revealProof.isErr) return Result.err(new EnchancedRevealError(revealProof.error, revealBodyHash));

	logger.trace("Waiting for reveal transaction to be processed", {
		id: traceId,
	});

	const gasOptions: GasOptions | undefined = appConfig.node.gasEstimationsEnabled
		? { gas: Math.round(estimateGasForReveal(dataRequest, executionResult) * appConfig.sedaChain.gasAdjustmentFactor) }
		: undefined;

	const revealResponse = await sedaChain.waitForSmartContractTransaction(
		{
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
		TransactionPriority.HIGH,
		undefined,
		gasOptions,
		undefined,
		traceId,
	);

	logger.trace("Reveal transaction processed", {
		id: traceId,
	});

	if (revealResponse.isErr) return Result.err(new EnchancedRevealError(revealResponse.error, revealBodyHash));
	return Result.ok();
}
