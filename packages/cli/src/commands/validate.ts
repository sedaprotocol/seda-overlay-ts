import { Command, Option } from "@commander-js/extra-typings";
import { loadConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Maybe } from "true-myth";
import { populateWithCommonOptions } from "../common-options";

export const validateCmd = populateWithCommonOptions(new Command("validate"))
	.addOption(new Option("--port <number>", "The port to run the HTTP server on").env("PORT"))
	.option("-s, --silent", "Silent mode", false)
	.description("Validates the SEDA Overlay node configuration")
	.action(async (options) => {
		const config = await loadConfig(Maybe.of(options.config), options.network, Maybe.nothing(), {
			sedaChain: {
				mnemonic: options.mnemonic,
			},
			httpServer: {
				port: options.port ? Number(options.port) : undefined,
			},
		});

		if (config.isOk && !options.silent) {
			logger.info(
				`Config: ${JSON.stringify(
					{
						...config.value,
						sedaChain: {
							...config.value.sedaChain,
							identities: Array.from(config.value.sedaChain.identities.entries()).map(([publicKey, privateKey]) => ({
								publicKey,
								privateKey: privateKey ? "***" : undefined,
							})),
							mnemonic: config.value.sedaChain.mnemonic ? "***" : undefined,
						},
					},
					(_, value) => (typeof value === "bigint" ? value.toString() : value),
					2,
				)}`,
			);
			logger.info("Overlay configuration is valid ✅");
		} else if (!config.isOk) {
			logger.error("Error while parsing config:");
			// TODO: Discuss how do we handle this ERROR for alerting & monitoring.

			for (const error of config.error) {
				logger.error(error);
				// TODO: Discuss how do we handle this ERROR for alerting & monitoring.
			}
			process.exit(1);
		}
	});
