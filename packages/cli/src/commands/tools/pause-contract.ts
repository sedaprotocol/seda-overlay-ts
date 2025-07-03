import { Command } from "@commander-js/extra-typings";
import type { ExecuteMsg } from "@sedaprotocol/core-contract-schema";
import { TransactionPriority } from "@sedaprotocol/overlay-ts-common";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { loadConfigAndSedaChain, populateWithCommonOptions } from "../../common-options";

export const pauseContract = populateWithCommonOptions(new Command("pause-contract"))
	.option("-p, --pause", "Pause the contract", false)
	.description("pauses the contract")
	.action(async (options) => {
		const { sedaChain, config } = await loadConfigAndSedaChain({
			config: options.config,
			mnemonic: options.mnemonic,
			network: options.network,
		});

		logger.info(`Using RPC: ${config.sedaChain.rpc}`);
		logger.info(`Using SEDA account ${sedaChain.getSignerAddress(0)}`);
		logger.info(`${options.pause ? "Pausing" : "Unpausing"} contract..`);

		const pauseOrUnpause: ExecuteMsg = options.pause ? { pause: {} } : { unpause: {} };

		const response = await sedaChain.waitForSmartContractTransaction(
			pauseOrUnpause,
			TransactionPriority.LOW,
			undefined,
			{
				gas: "auto",
				adjustmentFactor: config.sedaChain.gasAdjustmentFactorCosmosMessages,
			},
			0,
			"pause-contract",
		);

		if (response.isErr) {
			logger.error(`Pausing failed: ${response.error}`);
			process.exit(1);
		}

		logger.info("Successfully paused contract");
		process.exit(0);
	});
