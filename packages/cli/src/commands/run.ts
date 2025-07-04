import { Command, Option } from "@commander-js/extra-typings";
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
			runNode(config.value, {
				skipIdentityInitialization: false,
			});

			listenForExit(async () => {
				// Graceful shutdown handled by telemetry system
			});
		} else {
			logger.error("Error while parsing config:");

			// Record critical boot failure for config errors
			try {
				const { metricsHelpers } = await import("@sedaprotocol/overlay-ts-common");
				const configError = new Error(`Config parsing failed: ${config.error.join(", ")}`);
				metricsHelpers.recordCriticalError("node_boot", configError, {
					reason: "config_parsing_failure",
					boot_phase: "config_validation",
				});
			} catch (e) {
				// Ignore if telemetry is not available
			}

			for (const error of config.error) {
				logger.error(error);
			}
		}
	});
