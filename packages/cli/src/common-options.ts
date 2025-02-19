import { type Command, Option } from "@commander-js/extra-typings";

export function populateWithCommonOptions(command: Command) {
	return command
		.addOption(
			new Option("-c, --config <string>", "Path to the config.json").env("SEDA_CONFIG_PATH").default("./config.json"),
		)
		.addOption(new Option("--mnemonic <string>", "The mnemonic for the SEDA chain").env("SEDA_MNEMONIC"));
}
