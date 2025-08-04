import type { StakingConfig as StakingConfigFromContract } from "@sedaprotocol/core-contract-schema";
import type { SedaChainService } from "@sedaprotocol/overlay-ts-common";
import { Cache, queryContractSmart } from "@sedaprotocol/overlay-ts-common";
import type { Layer } from "effect";
import { Result } from "true-myth";

export interface StakingConfig {
	minimumStake: bigint;
	allowlistEnabled: boolean;
}

// Cache staking config for 1 hour
const STAKING_CONFIG_CACHE_TTL = 60 * 60 * 1000;
const stakingConfigCache = new Cache<StakingConfig>(STAKING_CONFIG_CACHE_TTL);

export async function getStakingConfig(
	sedaChain: Layer.Layer<SedaChainService>,
): Promise<Result<StakingConfig, Error>> {
	return stakingConfigCache.getOrFetch("staking_config", async () => {
		const response = await queryContractSmart<StakingConfigFromContract>(sedaChain, {
			get_staking_config: {},
		});

		if (response.isErr) {
			return Result.err(response.error);
		}

		const stakingConfig: StakingConfig = {
			minimumStake: BigInt(response.value.minimum_stake),
			allowlistEnabled: response.value.allowlist_enabled,
		};

		return Result.ok(stakingConfig);
	});
}
