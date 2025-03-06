import {
	type IsExecutorEligibleResponse,
	createEligibilityHash,
	createEligibilityMessageData,
} from "@sedaprotocol/core-contract-schema";
import { type SedaChain, debouncedInterval } from "@sedaprotocol/overlay-ts-common";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { EventEmitter } from "eventemitter3";
import { Maybe } from "true-myth";
import { type DataRequest, type DataRequestId, isDrStale } from "../models/data-request";
import { type DataRequestPool, IdentityDataRequestStatus } from "../models/data-request-pool";
import type { IdentityPool } from "../models/identitiest-pool";
import { getDataRequest } from "../services/get-data-requests";

type EventMap = {
	eligible: [DataRequestId, string];
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
	): Promise<{ identityId: string; eligible: boolean }> {
		const messageHash = createEligibilityHash(dataRequest.id, this.config.sedaChain.chainId, coreContractAddress);
		const messageSignature = this.identities.sign(identityId, messageHash);

		if (messageSignature.isErr) {
			logger.error(`Failed signing message for eligibility: ${messageSignature.error}`);
			return {
				eligible: false,
				identityId,
			};
		}

		const response = await this.sedaChain.queryContractSmart<IsExecutorEligibleResponse>({
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

		return {
			eligible: response.value,
			identityId,
		};
	}

	async checkEligibility(dataRequest: DataRequest) {
		const coreContractAddress = await this.sedaChain.getCoreContractAddress();
		// We check in parallel to speed things up
		const eligibilityChecks: Promise<void>[] = [];

		// Check if data request is stale and needs refreshing from chain
		if (isDrStale(dataRequest)) {
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
								Maybe.nothing(),
								IdentityDataRequestStatus.EligbleForExecution,
							);
							this.emit("eligible", dataRequest.id, response.identityId);
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
