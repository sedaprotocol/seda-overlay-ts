import { Command, Option } from "@commander-js/extra-typings";
import { loadConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { runNode } from "@sedaprotocol/overlay-ts-node";
import { listenForExit } from "@sedaprotocol/overlay-ts-node/src/services/listen-exit";
import { Maybe } from "true-myth";
import { populateWithCommonOptions } from "../common-options";
import { DEFAULT_HTTP_SERVER_PORT } from "@sedaprotocol/overlay-ts-config/src/constants";

export const run = populateWithCommonOptions(new Command("run"))
	.addOption(new Option("--port <number>", "The port to run the HTTP server on").default(DEFAULT_HTTP_SERVER_PORT).env("PORT"))
	.description("Runs the SEDA overlay node")
	.action(async (options) => {
		const config = await loadConfig(Maybe.of(options.config), options.network, Maybe.nothing(), {
			sedaChain: {
				mnemonic: options.mnemonic,
			},
			httpServer: {
				port: Number(options.port),
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
