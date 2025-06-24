import type { DrConfig as DrConfigFromContract } from "@sedaprotocol/core-contract-schema";
import type { SedaChain } from "@sedaprotocol/overlay-ts-common";
import { Result } from "true-myth";
import type { CamelCasedPropertiesDeep } from "type-fest";
import { Cache } from "./cache";
import { rpcMetrics } from "../internal-metrics";

export type DrConfig = CamelCasedPropertiesDeep<DrConfigFromContract>;

function transformDrConfig(drConfig: DrConfigFromContract): DrConfig {
	return {
		backupDelayInBlocks: drConfig.backup_delay_in_blocks,
		commitTimeoutInBlocks: drConfig.commit_timeout_in_blocks,
		consensusFilterLimitInBytes: drConfig.consensus_filter_limit_in_bytes,
		drRevealSizeLimitInBytes: drConfig.dr_reveal_size_limit_in_bytes,
		execInputLimitInBytes: drConfig.exec_input_limit_in_bytes,
		memoLimitInBytes: drConfig.memo_limit_in_bytes,
		paybackAddressLimitInBytes: drConfig.payback_address_limit_in_bytes,
		revealTimeoutInBlocks: drConfig.reveal_timeout_in_blocks,
		sedaPayloadLimitInBytes: drConfig.seda_payload_limit_in_bytes,
		tallyInputLimitInBytes: drConfig.tally_input_limit_in_bytes,
	};
}

const DR_CONFIG_CACHE_TTL = 1000 * 60 * 10; // 10 minutes
const drConfigCache = new Cache<DrConfig>(DR_CONFIG_CACHE_TTL);

export async function getDrConfig(sedaChain: SedaChain): Promise<Result<DrConfig, Error>> {
	return drConfigCache.getOrFetch("drConfig", async () => {
		rpcMetrics.incrementRpcCalls();
		const result = await sedaChain.queryContractSmart<DrConfigFromContract>({
			get_dr_config: {},
		});

		if (result.isErr) {
			return Result.err(result.error);
		}

		return Result.ok(transformDrConfig(result.value));
	});
}
