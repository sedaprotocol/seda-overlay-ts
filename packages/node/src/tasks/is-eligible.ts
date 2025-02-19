import { EventEmitter } from "node:events";
import {
	type IsExecutorEligibleResponse,
	createEligibilityHash,
	createEligibilityMessageData,
} from "@sedaprotocol/core-contract-schema";
import { type SedaChain, debouncedInterval } from "@sedaprotocol/overlay-ts-common";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Maybe } from "true-myth";
import type { DataRequest, DataRequestId } from "../models/data-request";
import { type DataRequestPool, IdentityDataRequestStatus } from "../models/data-request-pool";
import type { IdentityPool } from "../models/identitiest-pool";

type EventMap = {
	eligible: [DataRequestId, string];
};

export class EligibilityTask extends EventEmitter<EventMap> {
	private intervalId: Timer;

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
		const eligibilityChecks: Promise<{ identityId: string; eligible: boolean }>[] = [];

		for (const identityInfo of this.identities.all()) {
			// We already create an instance for this, no need to check eligibility
			if (this.pool.getIdentityDataRequest(dataRequest.id, identityInfo.identityId).isJust) {
				continue;
			}

			// If we don't have enough stake it doesn't make sense to check
			if (!identityInfo.enabled) continue;

			eligibilityChecks.push(
				this.checkIdentityEligibilityForDataRequest(dataRequest, identityInfo.identityId, coreContractAddress),
			);
		}

		const responses = await Promise.all(eligibilityChecks);

		for (const response of responses) {
			if (response.eligible) {
				this.pool.insertIdentityDataRequest(
					dataRequest.id,
					response.identityId,
					Maybe.nothing(),
					IdentityDataRequestStatus.EligbleForExecution,
				);
				this.emit("eligible", dataRequest.id, response.identityId);
			}
		}
	}

	async process() {
		const promises = [];

		for (const dataRequest of this.pool.allDataRequests()) {
			promises.push(this.checkEligibility(dataRequest));
		}

		await Promise.all(promises);
	}
}
