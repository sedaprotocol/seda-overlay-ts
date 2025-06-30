import { Command } from "@commander-js/extra-typings";
import type { StakingConfig as StakingConfigFromContract } from "@sedaprotocol/core-contract-schema";
import { formatTokenUnits } from "@sedaprotocol/overlay-ts-common";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { loadConfigAndSedaChain, populateWithCommonOptions } from "../../common-options";

export const chainConfig = populateWithCommonOptions(new Command("chain-config"))
	.description("gets the chain config")
	.action(async (options) => {
		const { sedaChain, config } = await loadConfigAndSedaChain({
			config: options.config,
			mnemonic: options.mnemonic,
			network: options.network,
		});

		logger.info(`Using RPC: ${config.sedaChain.rpc}`);
		logger.info(`Using SEDA account ${sedaChain.getSignerAddress(0)}`);

		const response = await sedaChain.queryContractSmart({
			get_dr_config: {},
		});

		if (response.isErr) {
			logger.error(`Failed fetching dr config: ${response.error}`);
			// TODO: Discuss how do we handle this ERROR for alerting & monitoring.
			process.exit(1);
		}

		const stakingConfig = await sedaChain.queryContractSmart<StakingConfigFromContract>({
			get_staking_config: {},
		});

		if (stakingConfig.isErr) {
			logger.error(`Failed fetching staking config: ${stakingConfig.error}`);
			// TODO: Discuss how do we handle this ERROR for alerting & monitoring.
			process.exit(1);
		}

		logger.info("DR Config");
		console.table(response.value);

		logger.info("Staking Config");
		stakingConfig.value.minimum_stake = `${formatTokenUnits(stakingConfig.value.minimum_stake, 18)} SEDA (or ${stakingConfig.value.minimum_stake} aSEDA)`;
		console.table(stakingConfig.value);

		process.exit(0);
	});
