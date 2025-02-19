import { Command } from "@commander-js/extra-typings";
import { loadConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { runNode } from "@sedaprotocol/overlay-ts-node";
import { listenForExit } from "@sedaprotocol/overlay-ts-node/src/services/listen-exit";
import { populateWithCommonOptions } from "../common-options";

export const run = populateWithCommonOptions(new Command("run"))
	.description("Runs the SEDA overlay node")
	.action(async (options) => {
		const config = await loadConfig(options.config, {
			sedaChain: {
				mnemonic: options.mnemonic,
			},
		});

		if (config.isOk) {
			const exitController = new AbortController();

			runNode(config.value, {
				exitController,
			});

			listenForExit(async () => {
				exitController.abort();
			});
		} else {
			logger.error("Error while parsing config:");

			for (const error of config.error) {
				logger.error(error);
			}
		}
	});
