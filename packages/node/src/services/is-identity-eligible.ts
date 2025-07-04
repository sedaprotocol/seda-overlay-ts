import { type Context, type Span, type Tracer, trace } from "@opentelemetry/api";
import type { GetExecutorEligibilityResponse } from "@sedaprotocol/core-contract-schema";
import { type SedaChain, getCurrentBlockHeight, keccak256, metricsHelpers } from "@sedaprotocol/overlay-ts-common";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Result } from "true-myth";
import type { DataRequest } from "../models/data-request";
import { getDrConfig } from "./dr-config";
import { type Staker, getStakers } from "./get-staker";
import { getStakingConfig } from "./get-staking-config";

function computeSelectionHash(publicKey: Buffer, drId: string): Buffer {
	return keccak256(Buffer.concat([publicKey, Buffer.from(drId, "hex")]));
}

function calculateDrEligibility(
	activeStakers: Staker[],
	targetPublicKey: Buffer,
	minimumStake: bigint,
	backupDelayInBlocks: number,
	drId: string,
	replicationFactor: number,
	blocksPassed: bigint,
	parentSpan: Span,
	tracer: Tracer,
	activeContext: Context,
): boolean {
	const ctx = trace.setSpan(activeContext, parentSpan);
	const span = tracer.startSpan("calculateDrEligibility", undefined, ctx);
	const targetHash = computeSelectionHash(targetPublicKey, drId);

	// Count total eligible stakers and stakers with lower hash in one pass
	const { totalStakers, lowerHashCount } = activeStakers
		.filter((staker) => staker.tokensStaked >= minimumStake)
		.reduce(
			(acc, staker) => {
				const stakerHash = computeSelectionHash(staker.publicKey, drId);
				return {
					totalStakers: acc.totalStakers + 1,
					lowerHashCount: acc.lowerHashCount + (stakerHash.compare(targetHash) < 0 ? 1 : 0),
				};
			},
			{ totalStakers: 0, lowerHashCount: 0 },
		);

	if (totalStakers === 0) {
		span.setAttributes({
			totalStakers: 0,
			isEligible: false,
		});
		span.end();
		return false;
	}

	// Calculate total needed stakers, capped by total available
	const totalNeeded =
		Number(blocksPassed) > backupDelayInBlocks
			? replicationFactor + Math.floor((Number(blocksPassed) - 1) / backupDelayInBlocks)
			: replicationFactor;

	const cappedTotalNeeded = Math.min(totalNeeded, totalStakers);

	// Staker is eligible if their position (by hash order) is within needed range
	const isEligible = lowerHashCount < cappedTotalNeeded;

	span.setAttributes({
		totalStakers: totalStakers,
		lowerHashCount: lowerHashCount,
		totalNeeded: totalNeeded,
		cappedTotalNeeded: cappedTotalNeeded,
		isEligible: isEligible,
	});

	span.end();
	return isEligible;
}

export async function isIdentityEligibleForDataRequest(
	sedaChain: SedaChain,
	identityId: string,
	dataRequest: DataRequest,
	parentSpan: Span,
	tracer: Tracer,
	activeContext: Context,
): Promise<Result<GetExecutorEligibilityResponse, Error>> {
	const ctx = trace.setSpan(activeContext, parentSpan);
	const span = tracer.startSpan("isIdentityEligibleForDataRequest", undefined, ctx);
	span.setAttributes({
		identityId: identityId,
		dataRequestId: dataRequest.id,
		dataRequestHeight: dataRequest.height.toString(),
	});

	const stakingConfigSpan = tracer.startSpan("getStakingConfig", undefined, trace.setSpan(activeContext, span));
	const stakingConfig = await getStakingConfig(sedaChain);
	stakingConfigSpan.end();

	if (stakingConfig.isErr) {
		logger.error(`Error while fetching staking config: ${stakingConfig.error}`);

		// Record RPC connectivity error for staking config fetch failure
		metricsHelpers.recordRpcError("eligibility", "getStakingConfig", stakingConfig.error, {
			dr_id: dataRequest.id,
			identity_id: identityId,
			operation: "fetch_staking_config",
		});

		span.end();
		return Result.err(stakingConfig.error);
	}

	const blockHeightSpan = tracer.startSpan("getCurrentBlockHeight", undefined, trace.setSpan(activeContext, span));
	const currentBlockHeight = await getCurrentBlockHeight(sedaChain);
	blockHeightSpan.end();

	if (currentBlockHeight.isErr) {
		logger.error(`Error while fetching current block height: ${currentBlockHeight.error}`);

		// Record RPC connectivity error for block height fetch failure
		metricsHelpers.recordRpcError("eligibility", "getCurrentBlockHeight", currentBlockHeight.error, {
			dr_id: dataRequest.id,
			identity_id: identityId,
			operation: "fetch_current_block_height",
		});

		span.end();
		return Result.err(currentBlockHeight.error);
	}

	const stakersSpan = tracer.startSpan("getStakers", undefined, trace.setSpan(activeContext, span));
	const stakers = await getStakers(sedaChain);
	stakersSpan.end();

	if (stakers.isErr) {
		logger.error(`Error while fetching stakers: ${stakers.error}`);

		// Record RPC connectivity error for stakers fetch failure
		metricsHelpers.recordRpcError("eligibility", "getStakers", stakers.error, {
			dr_id: dataRequest.id,
			identity_id: identityId,
			operation: "fetch_stakers",
		});

		span.end();
		return Result.err(stakers.error);
	}

	const drConfigSpan = tracer.startSpan("getDrConfig", undefined, trace.setSpan(activeContext, span));
	const drConfig = await getDrConfig(sedaChain);
	drConfigSpan.end();

	if (drConfig.isErr) {
		logger.error(`Error while fetching DR config: ${drConfig.error}`);

		// Record RPC connectivity error for DR config fetch failure
		metricsHelpers.recordRpcError("eligibility", "getDrConfig", drConfig.error, {
			dr_id: dataRequest.id,
			identity_id: identityId,
			operation: "fetch_dr_config",
		});

		span.end();
		return Result.err(drConfig.error);
	}

	const blocksPassed = BigInt(currentBlockHeight.value) - dataRequest.height;
	const identityPublicKey = Buffer.from(identityId, "hex");

	const isEligible = calculateDrEligibility(
		stakers.value,
		identityPublicKey,
		stakingConfig.value.minimumStake,
		drConfig.value.backupDelayInBlocks,
		dataRequest.id,
		dataRequest.replicationFactor,
		blocksPassed,
		span,
		tracer,
		activeContext,
	);

	span.end();

	return Result.ok({
		block_height: Number(currentBlockHeight.value),
		status: isEligible ? "eligible" : "not_eligible",
	});
}
