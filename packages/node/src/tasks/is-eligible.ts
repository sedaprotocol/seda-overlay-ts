import {
	type GetExecutorEligibilityResponse,
	createEligibilityHash,
	createEligibilityMessageData,
} from "@sedaprotocol/core-contract-schema";
import { type SedaChain, debouncedInterval } from "@sedaprotocol/overlay-ts-common";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { EventEmitter } from "eventemitter3";
import { Maybe } from "true-myth";
import { type DataRequest, type DataRequestId, isDrInRevealStage, isDrStale } from "../models/data-request";
import { type DataRequestPool, IdentityDataRequestStatus } from "../models/data-request-pool";
import type { IdentityPool } from "../models/identitiest-pool";
import { getDataRequest } from "../services/get-data-requests";

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

	constructor(
		private pool: DataRequestPool,
		private identities: IdentityPool,
		private config: AppConfig,
		private sedaChain: SedaChain,
	) {
		super();

		this.intervalId = debouncedInterval(async () => {
			await this.process();
		}, config.intervals.eligibilityCheck);
	}

	stop() {
		clearInterval(this.intervalId);
	}

	private async checkIdentityEligibilityForDataRequest(
		dataRequest: DataRequest,
		identityId: string,
		coreContractAddress: string,
	): Promise<EligibilityCheckResult> {
		const messageHash = createEligibilityHash(dataRequest.id, this.config.sedaChain.chainId, coreContractAddress);
		const messageSignature = this.identities.sign(identityId, messageHash);

		if (messageSignature.isErr) {
			logger.error(`Failed signing message for eligibility: ${messageSignature.error}`);
			return {
				eligible: false,
				identityId,
			};
		}

		const response = await this.sedaChain.queryContractSmart<GetExecutorEligibilityResponse>({
			is_executor_eligible: {
				data: createEligibilityMessageData(identityId, dataRequest.id, messageSignature.value),
			},
		});

		if (response.isErr) {
			logger.error(`Could not fetch eligibility status for data request: ${response.error}`);
			return {
				eligible: false,
				identityId,
			};
		}

		logger.debug(
			`${response.value.status === "eligible" ? "🟢 Eligible" : "🔴 Not eligible: ${response.value.status}"}`,
			{
				id: dataRequest.id,
			},
		);

		// Check if the data request is still in Commit Stage on chain
		const drFromChain = await getDataRequest(dataRequest.id, this.sedaChain);
		if (drFromChain.isErr) {
			logger.error(`Could not fetch data request from chain: ${drFromChain.error}`);
			return {
				eligible: false,
				identityId,
			};
		}
		if (drFromChain.isOk) {
			if (drFromChain.value.isNothing) {
				this.pool.deleteDataRequest(dataRequest.id);
				logger.info("🏁 Data Request no longer exists on chain - likely resolved", {
					id: dataRequest.id,
				});

				return {
					eligible: false,
					identityId,
				};
			}
			// Edge case where the `is_executor_eligible` query returns true but the data request is already in reveal stage
			// Note: `is_executor_eligible` only checks that request exists and eligibility is valid
			if (
				drFromChain.value.isJust &&
				drFromChain.value.value.commitsLength === drFromChain.value.value.replicationFactor
			) {
				logger.debug("💨 Data Request already in reveal stage - skipping eligibility check", {
					id: dataRequest.id,
				});
				return {
					eligible: false,
					identityId,
				};
			}
		}

		return {
			eligible: response.value.status === "eligible",
			identityId,
			height: BigInt(response.value.block_height),
		};
	}

	async checkEligibility(dataRequest: DataRequest) {
		const coreContractAddress = await this.sedaChain.getCoreContractAddress();
		// We check in parallel to speed things up
		const eligibilityChecks: Promise<void>[] = [];

		// Check if data request is stale and needs refreshing from chain
		if (isDrStale(dataRequest)) {
			logger.debug("Data Request is stale, refreshing from chain", {
				id: dataRequest.id,
			});
			const result = await getDataRequest(dataRequest.id, this.sedaChain);

			const isResolved = result.match({
				Ok: (refreshedDr) => {
					if (refreshedDr.isNothing) {
						this.pool.deleteDataRequest(dataRequest.id);
						logger.info("✅ Data Request has been resolved on chain", {
							id: dataRequest.id,
						});

						return true;
					}

					return false;
				},
				Err: (error) => {
					logger.error(`Could not fetch information about dr: ${error}`, {
						id: dataRequest.id,
					});

					return false;
				},
			});

			if (isResolved) return;
		}

		// When the data request is in the reveal stage we can't process it
		// other nodes will take care of it
		if (isDrInRevealStage(dataRequest)) {
			// If no identities are currently processing this data request, we can stop checking eligibility
			if (!this.pool.isDrBeingProcessed(dataRequest.id)) {
				logger.debug("Dr is in reveal stage, and no identities are processing it, deleting from pool", {
					id: dataRequest.id,
				});
				this.pool.deleteDataRequest(dataRequest.id);
				return;
			}
			return;
		}

		for (const identityInfo of this.identities.all()) {
			// We already create an instance for this, no need to check eligibility
			if (this.pool.getIdentityDataRequest(dataRequest.id, identityInfo.identityId).isJust) {
				continue;
			}

			// If we don't have enough stake it doesn't make sense to check
			if (!identityInfo.enabled) continue;

			eligibilityChecks.push(
				this.checkIdentityEligibilityForDataRequest(dataRequest, identityInfo.identityId, coreContractAddress).then(
					(response) => {
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
					},
				),
			);
		}

		await Promise.all(eligibilityChecks);
	}

	async process() {
		if (this.isProcessing) return;
		this.isProcessing = true;

		const promises = [];

		for (const dataRequest of this.pool.allDataRequests()) {
			promises.push(this.checkEligibility(dataRequest));
		}

		await Promise.all(promises);
		this.isProcessing = false;
	}
}
