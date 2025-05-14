import { Command } from "@commander-js/extra-typings";
import type { GetExecutorsResponse } from "@sedaprotocol/core-contract-schema";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { loadConfigAndSedaChain, populateWithCommonOptions } from "../../common-options";

export const availableExecutors = populateWithCommonOptions(new Command("available-executors"))
	.description("lists all available executors")
	.action(async (options) => {
		const { sedaChain } = await loadConfigAndSedaChain({
			config: options.config,
			mnemonic: options.mnemonic,
			network: options.network,
		});

		logger.info("Listing available executors..");

		const response = await sedaChain.queryContractSmart<GetExecutorsResponse>({
			get_executors: {
				limit: 100,
				offset: 0,
			},
		});

		if (response.isErr) {
			logger.error(`Listing failed: ${response.error}`);
			process.exit(1);
		}

		console.table(response.value.executors);

		logger.info("Succesfully listed available executors");
		process.exit(0);
	});
