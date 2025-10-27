import { MsgReveal } from "@seda-protocol/proto-messages/libs/proto-messages/gen/sedachain/core/v1/tx";
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

	const revealMsg = {
		typeUrl: "/sedachain.core.v1.MsgReveal",
		value: MsgReveal.fromPartial({
			publicKey: identityId,
			proof: revealProof.value.toString("hex"),
			stderr: executionResult.stderr,
			stdout: executionResult.stdout,
			revealBody: {
				drID: dataRequest.id,
				drBlockHeight: BigInt(executionResult.revealBody.dr_block_height),
				exitCode: executionResult.revealBody.exit_code,
				gasUsed: executionResult.revealBody.gas_used,
				reveal: executionResult.revealBody.reveal,
				proxyPubKeys: executionResult.revealBody.proxy_public_keys,
			},
		}),
	};
	const revealResponse = await sedaChain.queueCosmosMessage(revealMsg, TransactionPriority.HIGH, gasOptions);

	logger.trace("Reveal transaction processed", {
		id: traceId,
	});

	if (revealResponse.isErr) return Result.err(new EnchancedRevealError(revealResponse.error, revealBodyHash));
	return Result.ok();
}
