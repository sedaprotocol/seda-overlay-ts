import { Command } from "@commander-js/extra-typings";
import type { StakingConfig as StakingConfigFromContract } from "@sedaprotocol/core-contract-schema";
import { SedaChainService, formatTokenUnits } from "@sedaprotocol/overlay-ts-common";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Effect } from "effect";
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

		await Effect.runPromise(
			Effect.gen(function* () {
				const sedaChain = yield* SedaChainService;

				const response = yield* sedaChain
					.queryContractSmart({
						get_dr_config: {},
					})
					.pipe(Effect.mapError((e) => new Error(`Failed fetching dr config: ${e}`)));

				const stakingConfig = yield* sedaChain
					.queryContractSmart<StakingConfigFromContract>({
						get_staking_config: {},
					})
					.pipe(Effect.mapError((e) => new Error(`Failed fetching staking config: ${e}`)));

				logger.info("DR Config");
				console.table(response);

				logger.info("Staking Config");
				stakingConfig.minimum_stake = `${formatTokenUnits(stakingConfig.minimum_stake, 18)} SEDA (or ${stakingConfig.minimum_stake} aSEDA)`;
				console.table(stakingConfig);

				process.exit(0);
			})
				.pipe(Effect.provide(sedaChain))
				.pipe(
					Effect.catchAll((error) => {
						logger.error(`${error}`);
						process.exit(1);

						return Effect.succeed(void 0);
					}),
				),
		);
	});
