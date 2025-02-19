import { type Command, Option } from "@commander-js/extra-typings";
import { SedaChain } from "@sedaprotocol/overlay-ts-common";
import { type AppConfig, loadConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";

export function populateWithCommonOptions(command: Command) {
	return command
		.addOption(
			new Option("-c, --config <string>", "Path to the config.json").env("SEDA_CONFIG_PATH").default("./config.json"),
		)
		.addOption(new Option("--mnemonic <string>", "The mnemonic for the SEDA chain").env("SEDA_MNEMONIC"));
}

export async function loadConfigAndSedaChain(options: { config: string; mnemonic: string | undefined }): Promise<{
	sedaChain: SedaChain;
	config: AppConfig;
}> {
	const config = await loadConfig(options.config, {
		sedaChain: {
			mnemonic: options.mnemonic,
		},
	});

	if (config.isErr) {
		logger.error("Error while parsing config:");

		for (const error of config.error) {
			logger.error(error);
		}
		process.exit(1);
	}

	const sedaChain = await SedaChain.fromConfig(config.value, false);

	if (sedaChain.isErr) {
		logger.error(`Could not create SEDA chain instance: ${sedaChain.error}`);
		process.exit(1);
	}

	sedaChain.value.start();

	return {
		config: config.value,
		sedaChain: sedaChain.value,
	};
}
