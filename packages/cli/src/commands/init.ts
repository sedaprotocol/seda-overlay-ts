import { Command } from "@commander-js/extra-typings";
import { createConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Maybe } from "true-myth";
import { populateWithCommonOptions } from "../common-options";

export const init = populateWithCommonOptions(new Command("init"))
	.description("Initializes the SEDA overlay node")
	.action(async (options) => {
		logger.info("Initializing the overlay node..");
		const createdConfig = await createConfig(Maybe.of(options.config), Maybe.nothing(), options.network);

		if (createdConfig.isErr) {
			logger.error(createdConfig.error.message);
			process.exit(1);
		}

		logger.info(`Config file has been created at: ${createdConfig.value}`);
		logger.info("Please fill in all properties");
	});
