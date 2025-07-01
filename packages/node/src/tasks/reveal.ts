import { createRevealBodyHash, createRevealMessageHash } from "@sedaprotocol/core-contract-schema/src/commit";
// import { createRevealMessageSignatureHash } from "@sedaprotocol/core-contract-schema";
import { type SedaChain, TransactionPriority } from "@sedaprotocol/overlay-ts-common";
import type { AlreadyRevealed, DataRequestExpired, RevealMismatch } from "@sedaprotocol/overlay-ts-common";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Result, type Unit } from "true-myth";
import type { DataRequest } from "../models/data-request";
import type { ExecutionResult } from "../models/execution-result";
import type { IdentityPool } from "../models/identitiest-pool";

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
): Promise<Result<Buffer, EnchancedRevealError>> {
	const traceId = `${dataRequest.id}_${identityId}`;

	const contractAddr = await sedaChain.getCoreContractAddress();

	logger.trace("Creating reveal proof", {
		id: traceId,
	});

	const revealBodyHash = createRevealBodyHash(executionResult.revealBody);
	const revealMessageHash = createRevealMessageHash(revealBodyHash, appConfig.sedaChain.chainId, contractAddr);
	const revealProof = identityPool.sign(identityId, revealMessageHash);
	if (revealProof.isErr) return Result.err(new EnchancedRevealError(revealProof.error, revealBodyHash));

	logger.trace("Submitting reveal transaction (non-blocking)", {
		id: traceId,
	});

	const revealResponse = await sedaChain.queueSmartContractMessage(
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
		undefined,
		undefined,
		traceId,
	);

	logger.trace("Reveal transaction queued", {
		id: traceId,
	});

	if (revealResponse.isErr) return Result.err(new EnchancedRevealError(revealResponse.error, revealBodyHash));
	
	// Return the transaction hash instead of waiting for completion
	return Result.ok(Buffer.from(revealResponse.value, 'hex'));
}
