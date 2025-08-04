import { debouncedInterval, effectToAsyncResult } from "@sedaprotocol/overlay-ts-common";
import type { SedaChainService } from "@sedaprotocol/overlay-ts-common";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Effect, type Layer, Option, Schedule } from "effect";
import { Result, type Unit } from "true-myth";
import type { IdentityPool } from "../models/identitiest-pool";
import { getStaker } from "../services/get-staker";
import { getStakingConfig } from "../services/get-staking-config";
import { sendSedaToSubAccounts } from "./send-seda";

export class IdentityManagerTask {
	constructor(
		private identityPool: IdentityPool,
		private config: AppConfig,
		private sedaChain: Layer.Layer<SedaChainService>,
	) {}

	async isIdentityEnabled(identity: string): Promise<Result<boolean, Error>> {
		const staker = await effectToAsyncResult(getStaker(identity).pipe(Effect.provide(this.sedaChain)));

		if (staker.isErr) {
			logger.error(`Could not fetch staker info: ${staker.error}`, {
				id: `identity_${identity}`,
			});

			return Result.err(staker.error);
		}

		if (Option.isNone(staker.value)) {
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

		const isEnabled = staker.value.value.tokensStaked >= stakingConfig.value.minimumStake;

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
		await Effect.runPromise(sendSedaToSubAccounts(this.config).pipe(Effect.provide(this.sedaChain)));

		// Initial check
		(await this.processAllIdentities()).mapErr((error) => {
			throw error;
		});

		Effect.runPromise(
			sendSedaToSubAccounts(this.config).pipe(
				Effect.provide(this.sedaChain),
				Effect.schedule(Schedule.spaced(this.config.intervals.identityCheck)),
				Effect.catchAll((error) => {
					logger.error(`Error while sending SEDA to sub accounts: ${error}`);
					return Effect.succeed(void 0);
				}),
			),
		);

		// Set up periodic checks
		debouncedInterval(async () => {
			await this.processAllIdentities();
		}, this.config.intervals.identityCheck);
	}
}
