import { type Span, type Tracer, context, trace } from "@opentelemetry/api";
import {
	type GetExecutorEligibilityResponse,
	createEligibilityHash,
	createEligibilityMessageData,
} from "@sedaprotocol/core-contract-schema";
import { type SedaChain, debouncedInterval } from "@sedaprotocol/overlay-ts-common";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { EventEmitter } from "eventemitter3";
import { Maybe, Result } from "true-myth";
import { match } from "ts-pattern";
import { type DataRequest, type DataRequestId, isDrInRevealStage, isDrStale } from "../models/data-request";
import { type DataRequestPool, IdentityDataRequestStatus } from "../models/data-request-pool";
import type { IdentityPool } from "../models/identitiest-pool";
import { getDataRequest } from "../services/get-data-requests";
import { isIdentityEligibleForDataRequest } from "../services/is-identity-eligible";

type EventMap = {
	eligible: [drId: DataRequestId, eligibilityHeight: bigint, identityId: string];
};

type EligibilityCheckResult =
	| {
			identityId: string;
			eligible: false;
	  }
	| {
			identityId: string;
			eligible: true;
			height: bigint;
	  };

// TODO: Move eligibility checking to a worker thread to improve performance with large identity pools.
// Since eligibility verification is CPU-bound and independent of other operations,
// offloading it would prevent blocking the main event loop.
export class EligibilityTask extends EventEmitter<EventMap> {
	private intervalId: Timer;
	private isProcessing = false;
	private eligibilityTracer: Tracer;

	constructor(
		private pool: DataRequestPool,
		private identities: IdentityPool,
		private config: AppConfig,
		private sedaChain: SedaChain,
	) {
		super();
		this.eligibilityTracer = trace.getTracer("eligibility-task");

		this.intervalId = debouncedInterval(async () => {
			await this.process();
		}, config.intervals.eligibilityCheck);
	}

	stop() {
		const span = this.eligibilityTracer.startSpan("eligibility-task-stop");
		clearInterval(this.intervalId);
		span.end();
	}

	private async checkIdentityEligibilityForDataRequest(
		dataRequest: DataRequest,
		identityId: string,
		coreContractAddress: string,
		parentSpan: Span,
	): Promise<EligibilityCheckResult> {
		const traceId = `${dataRequest.id}_${identityId}`;
		const ctx = trace.setSpan(context.active(), parentSpan);
		const span = this.eligibilityTracer.startSpan("check-identity-eligibility", undefined, ctx);

		span.setAttribute("dr_id", dataRequest.id);
		span.setAttribute("identity_id", identityId);
		span.setAttribute("core_contract_address", coreContractAddress);

		const querySpan = this.eligibilityTracer.startSpan(
			"query-contract-eligibility",
			undefined,
			trace.setSpan(context.active(), span),
		);

		logger.trace("Checking identity eligibility for data request", {
			id: traceId,
		});

		// So we can enable and disable offline eligibility through the config
		const response: Result<GetExecutorEligibilityResponse, Error> = await match(this.config.node.offlineEligibility)
			.with(true, async () => {
				const response = await isIdentityEligibleForDataRequest(
					this.sedaChain,
					identityId,
					dataRequest,
					span,
					this.eligibilityTracer,
					context.active(),
				);

				return response;
			})
			.with(false, async () => {
				const messageHash = createEligibilityHash(dataRequest.id, this.config.sedaChain.chainId, coreContractAddress);
				const messageSignature = this.identities.sign(identityId, messageHash);

				if (messageSignature.isErr) {
					logger.error(`Failed signing message for eligibility: ${messageSignature.error}`, {
						id: traceId,
					});
					return Result.err(messageSignature.error);
				}

				const response = await this.sedaChain.queryContractSmart<GetExecutorEligibilityResponse>({
					is_executor_eligible: {
						data: createEligibilityMessageData(identityId, dataRequest.id, messageSignature.value),
					},
				});

				return response;
			})
			.exhaustive();

		querySpan.end();

		if (response.isErr) {
			logger.error(`Could not fetch eligibility status for data request: ${response.error}`, {
				id: traceId,
			});
			span.recordException(response.error);
			span.setAttribute("error", "query_failed");
			span.end();

			return {
				eligible: false,
				identityId,
			};
		}

		logger.debug(response.value.status === "eligible" ? "🟢 Eligible" : `🔴 Not eligible: ${response.value.status}`, {
			id: traceId,
		});

		// Check if the data request is still in Commit Stage on chain
		const drCheckSpan = this.eligibilityTracer.startSpan(
			"check-dr-status",
			undefined,
			trace.setSpan(context.active(), span),
		);
		const drFromChain = await getDataRequest(dataRequest.id, this.sedaChain);
		drCheckSpan.end();

		if (drFromChain.isErr) {
			logger.error(`Could not fetch data request from chain: ${drFromChain.error}`, {
				id: traceId,
			});
			span.recordException(drFromChain.error);
			span.setAttribute("error", "dr_fetch_failed");
			span.end();

			return {
				eligible: false,
				identityId,
			};
		}
		if (drFromChain.isOk) {
			if (drFromChain.value.isNothing) {
				this.pool.deleteDataRequest(dataRequest.id);
				logger.info("🏁 Data Request no longer exists on chain - likely resolved", {
					id: traceId,
				});
				span.setAttribute("status", "resolved");
				span.end();

				return {
					eligible: false,
					identityId,
				};
			}
			// Edge case where the `is_executor_eligible` query returns true but the data request is already in reveal stage
			// Note: `is_executor_eligible` only checks that request exists and eligibility is valid
			if (drFromChain.value.isJust && isDrInRevealStage(drFromChain.value.value)) {
				logger.debug("💨 Data Request already in reveal stage - skipping eligibility check", {
					id: traceId,
				});
				span.setAttribute("status", "in_reveal_stage");
				span.end();

				return {
					eligible: false,
					identityId,
				};
			}
		}

		span.setAttribute("status", response.value.status);
		span.end();

		return {
			eligible: response.value.status === "eligible",
			identityId,
			height: BigInt(response.value.block_height),
		};
	}

	async checkEligibility(dataRequest: DataRequest, parentSpan: Span) {
		const traceId = `${dataRequest.id}`;
		const ctx = trace.setSpan(context.active(), parentSpan);
		const span = this.eligibilityTracer.startSpan("check-eligibility", undefined, ctx);

		span.setAttribute("dr_id", dataRequest.id);

		const coreContractAddress = await this.sedaChain.getCoreContractAddress();
		// We check in parallel to speed things up
		const eligibilityChecks: Promise<void>[] = [];

		// Check if data request is stale and needs refreshing from chain
		if (isDrStale(dataRequest)) {
			logger.debug("Data Request is stale, refreshing from chain", {
				id: traceId,
			});
			const refreshSpan = this.eligibilityTracer.startSpan(
				"refresh-stale-dr",
				undefined,
				trace.setSpan(context.active(), span),
			);
			const result = await getDataRequest(dataRequest.id, this.sedaChain);
			refreshSpan.end();

			const isResolved = result.match({
				Ok: (refreshedDr) => {
					if (refreshedDr.isNothing) {
						this.pool.deleteDataRequest(dataRequest.id);
						logger.info("✅ Data Request has been resolved on chain", {
							id: traceId,
						});
						span.setAttribute("status", "resolved");
						return true;
					}

					return false;
				},
				Err: (error) => {
					logger.error(`Could not fetch information about dr: ${error}`, {
						id: traceId,
					});
					span.recordException(error);
					span.setAttribute("error", "refresh_failed");
					return false;
				},
			});

			if (isResolved) {
				span.end();
				return;
			}
		}

		// When the data request is in the reveal stage we can't process it
		// other nodes will take care of it
		if (isDrInRevealStage(dataRequest)) {
			// If no identities are currently processing this data request, we can stop checking eligibility
			if (!this.pool.isDrBeingProcessed(dataRequest.id)) {
				logger.debug("Dr is in reveal stage, and no identities are processing it, deleting from pool", {
					id: traceId,
				});
				this.pool.deleteDataRequest(dataRequest.id);
				span.setAttribute("status", "in_reveal_stage");
				span.end();
				return;
			}
			span.end();
			return;
		}

		logger.trace(`Checking eligibility for ${this.config.sedaChain.identityIds.length} identity(ies)`, {
			id: traceId,
		});

		span.setAttribute("total_identities", this.config.sedaChain.identityIds.length);

		for (const identityInfo of this.identities.all()) {
			// We already create an instance for this, no need to check eligibility
			if (this.pool.getIdentityDataRequest(dataRequest.id, identityInfo.identityId).isJust) {
				continue;
			}

			// If we don't have enough stake it doesn't make sense to check
			if (!identityInfo.enabled) {
				logger.error(`Identity ${identityInfo.identityId} is not enabled, skipping eligibility check`, {
					id: traceId,
				});
				continue;
			}

			eligibilityChecks.push(
				this.checkIdentityEligibilityForDataRequest(
					dataRequest,
					identityInfo.identityId,
					coreContractAddress,
					span,
				).then((response) => {
					if (response.eligible) {
						this.pool.insertIdentityDataRequest(
							dataRequest.id,
							response.identityId,
							response.height,
							Maybe.nothing(),
							IdentityDataRequestStatus.EligibleForExecution,
						);
						this.emit("eligible", dataRequest.id, response.height, response.identityId);
					}
				}),
			);
		}

		await Promise.all(eligibilityChecks);
		span.end();
	}

	async process() {
		if (this.isProcessing) return;
		this.isProcessing = true;

		const span = this.eligibilityTracer.startSpan("process-eligibility");
		span.setAttribute("pool_size", this.pool.size);

		const promises = [];

		for (const dataRequest of this.pool.allDataRequests()) {
			promises.push(this.checkEligibility(dataRequest, span));
		}

		await Promise.all(promises);
		this.isProcessing = false;
		span.end();
	}
}
