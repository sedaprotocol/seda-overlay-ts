import { tryAsync } from "@seda-protocol/utils";
import type { SedaChain } from "@sedaprotocol/overlay-ts-common";
import { Cache } from "@sedaprotocol/overlay-ts-common";
import { Result } from "true-myth";

export interface StakingConfig {
	minimumStake: bigint;
	allowlistEnabled: boolean;
}

// Cache staking config for 1 hour
const STAKING_CONFIG_CACHE_TTL = 60 * 60 * 1000;
const stakingConfigCache = new Cache<StakingConfig>(STAKING_CONFIG_CACHE_TTL);

export async function getStakingConfig(sedaChain: SedaChain): Promise<Result<StakingConfig, Error>> {
	return stakingConfigCache.getOrFetch("staking_config", async () => {
		const response = await tryAsync(sedaChain.getCoreQueryClient().StakingConfig({}));

		if (response.isErr) {
			return Result.err(response.error);
		}

		if (!response.value.stakingConfig) {
			return Result.err(new Error("Staking config not found"));
		}

		const stakingConfig: StakingConfig = {
			minimumStake: BigInt(response.value.stakingConfig.minimumStake),
			allowlistEnabled: response.value.stakingConfig.allowlistEnabled,
		};

		return Result.ok(stakingConfig);
	});
}
