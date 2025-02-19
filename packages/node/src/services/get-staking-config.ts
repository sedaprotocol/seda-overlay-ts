import type { SedaChain } from "@sedaprotocol/overlay-ts-common";
import { Result } from "true-myth";
import { Cache } from "./cache";

interface StakingConfigFromContract {
	minimum_stake_to_register: string;
	minimum_stake_for_committee_eligibility: string;
	allowlist_enabled: boolean;
}

export interface StakingConfig {
	minimumStakeToRegister: bigint;
	minimumStakeForCommitteeEligibility: bigint;
	allowlistEnabled: boolean;
}

// Cache staking config for 1 hour
const STAKING_CONFIG_CACHE_TTL = 60 * 60 * 1000;
const stakingConfigCache = new Cache<StakingConfig>(STAKING_CONFIG_CACHE_TTL);

export async function getStakingConfig(sedaChain: SedaChain): Promise<Result<StakingConfig, Error>> {
	return stakingConfigCache.getOrFetch("staking_config", async () => {
		const response = await sedaChain.queryContractSmart<StakingConfigFromContract>({
			get_staking_config: {},
		});

		if (response.isErr) {
			return Result.err(response.error);
		}

		const stakingConfig: StakingConfig = {
			minimumStakeToRegister: BigInt(response.value.minimum_stake_to_register),
			minimumStakeForCommitteeEligibility: BigInt(response.value.minimum_stake_for_committee_eligibility),
			allowlistEnabled: response.value.allowlist_enabled,
		};

		return Result.ok(stakingConfig);
	});
}
