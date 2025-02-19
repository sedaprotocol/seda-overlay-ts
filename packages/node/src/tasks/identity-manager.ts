import { debouncedInterval } from "@sedaprotocol/overlay-ts-common";
import type { SedaChain } from "@sedaprotocol/overlay-ts-common";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Result, type Unit } from "true-myth";
import type { IdentityPool } from "../models/identitiest-pool";
import { getStaker } from "../services/get-staker";
import { getStakingConfig } from "../services/get-staking-config";

export class IdentityManagerTask {
	constructor(
		private identityPool: IdentityPool,
		private config: AppConfig,
		private sedaChain: SedaChain,
	) {}

	async isIdentityEnabled(identity: string): Promise<Result<boolean, Error>> {
		const staker = await getStaker(this.sedaChain, identity);

		if (staker.isErr) {
			logger.error(`Could not fetch staker info: ${staker.error}`, {
				id: `identity_${identity}`,
			});

			return Result.err(staker.error);
		}

		if (staker.value.isNothing) {
			logger.error("Could not find staker info, did you register it?", {
				id: `identity_${identity}`,
			});

			return Result.err(new Error("Staker info was empty"));
		}

		const stakingConfig = await getStakingConfig(this.sedaChain);

		if (stakingConfig.isErr) {
			logger.error(`Could not fetch staking config: ${stakingConfig.error}`);
			return Result.err(stakingConfig.error);
		}

		const isEnabled = staker.value.value.tokensStaked >= stakingConfig.value.minimumStakeForCommitteeEligibility;

		// Just for logging purposes
		this.identityPool.getIdentityInfo(identity).match({
			Just: (info) => {
				if (!info.enabled && isEnabled) {
					logger.info("🟢 Identity active - Stake requirement met", {
						id: `identity_${info.identityId}`,
					});
				}

				if (info.enabled && !isEnabled) {
					logger.warn("🟡 Identity inactive - Stake below required threshold", {
						id: `identity_${info.identityId}`,
					});
				}

				if (!info.enabled && !isEnabled) {
					logger.warn("🔴 Identity inactive - No stake or below minimum", {
						id: `identity_${info.identityId}`,
					});
				}
			},
			Nothing: () => {
				logger.error("Identity could not be found in pool", {
					id: `identity_${identity}`,
				});
			},
		});

		this.identityPool.setEnabledStatus(identity, isEnabled);
		return Result.ok(isEnabled);
	}

	private async processAllIdentities(): Promise<Result<Unit, Error>> {
		for (const identityInfo of this.identityPool.all()) {
			const result = await this.isIdentityEnabled(identityInfo.identityId);

			if (result.isErr) {
				return Result.err(result.error);
			}
		}

		return Result.ok();
	}

	async start() {
		// Initial check
		(await this.processAllIdentities()).mapErr((error) => {
			throw error;
		});

		// Set up periodic checks
		debouncedInterval(async () => {
			await this.processAllIdentities();
		}, this.config.intervals.identityCheck);
	}
}
