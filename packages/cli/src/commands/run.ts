import { Command, Option } from "@commander-js/extra-typings";
import { customMetrics } from "@sedaprotocol/overlay-ts-common";
import { loadConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { runNode } from "@sedaprotocol/overlay-ts-node";
import { listenForExit } from "@sedaprotocol/overlay-ts-node/src/services/listen-exit";
import { Maybe } from "true-myth";
import { populateWithCommonOptions } from "../common-options";

export const runCmd = populateWithCommonOptions(new Command("run"))
	.addOption(new Option("--port <number>", "The port to run the HTTP server on").env("PORT"))
	.description("Runs the SEDA Overlay node")
	.action(async (options) => {
		const config = await loadConfig(Maybe.of(options.config), options.network, Maybe.nothing(), {
			sedaChain: {
				mnemonic: options.mnemonic,
			},
			httpServer: {
				port: options.port ? Number(options.port) : undefined,
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

			// CRITICAL-001: Node Boot Failure - Config parsing failed
			customMetrics.nodeBootFailures.add(1, {
				type: 'config_parsing_failure',
				error_count: config.error.length.toString(),
				reason: 'invalid_config',
			});

			for (const error of config.error) {
				logger.error(error);
			}
		}
	});
