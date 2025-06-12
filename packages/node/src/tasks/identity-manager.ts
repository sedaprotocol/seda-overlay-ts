import { GasPrice } from "@cosmjs/stargate";
import { debouncedInterval, formatTokenUnits, sleep } from "@sedaprotocol/overlay-ts-common";
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

	/**
	 * Making sure all accounts have at least the minimum SEDA amount
	 * This is to be able to execute transactions on the chain. Not alot is needed since the chain refunds succesfully executed transactions.
	 * 
	 * TODO: This is a very bad implementation. We should use a better way to do this. It does not take sequence numbers into account.
	 */
	private async sendTokensToAllAddresses() {
		const sender = this.sedaChain.getSignerAddress(0);

		// @ts-ignore
		this.sedaChain.signerClients[0].gasPrice = GasPrice.fromString(`${this.config.sedaChain.gasPrice}aseda`);

		for (const [accountIndex, _] of this.sedaChain.signerClients.entries()) {
			if (accountIndex === 0) continue;

			const balance = await this.sedaChain.signerClients[0].getBalance(
				this.sedaChain.getSignerAddress(accountIndex),
				"aseda",
			);

			if (BigInt(balance.amount) < this.config.sedaChain.minSedaPerAccount) {
				logger.info(
					`${accountIndex}: Sending ${formatTokenUnits(this.config.sedaChain.minSedaPerAccount)} SEDA to ${this.sedaChain.getSignerAddress(accountIndex)}`,
				);

				await this.sedaChain.signerClients[0].sendTokens(
					sender,
					this.sedaChain.getSignerAddress(accountIndex),
					[
						{
							denom: "aseda",
							amount: this.config.sedaChain.minSedaPerAccount.toString(),
						},
					],
					"auto",
				);

				logger.info(
					`${accountIndex}: Sent ${formatTokenUnits(this.config.sedaChain.minSedaPerAccount)} SEDA to ${this.sedaChain.getSignerAddress(accountIndex)}`,
				);

				await sleep(2000);
			} else {
				logger.info(
					`${accountIndex}: ${this.sedaChain.getSignerAddress(accountIndex)} has enough SEDA (min: ${formatTokenUnits(this.config.sedaChain.minSedaPerAccount)} SEDA, current: ${formatTokenUnits(balance.amount)} SEDA)`,
				);
			}
		}
	}

	async start() {
		await this.sendTokensToAllAddresses();

		// Initial check
		(await this.processAllIdentities()).mapErr((error) => {
			throw error;
		});

		// Set up periodic checks
		debouncedInterval(async () => {
			await this.processAllIdentities();
		}, this.config.intervals.identityCheck);

		process.exit(0);
	}
}
