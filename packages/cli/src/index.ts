import { homedir } from "node:os";
import { join } from "node:path";
import { Command } from "@commander-js/extra-typings";
import dotenv from "@dotenvx/dotenvx";
import { isBrowser } from "@sedaprotocol/overlay-ts-common";
import { version } from "../../../package.json";
import { identities } from "./commands/identities/identities";
import { init } from "./commands/init";
import { runCmd } from "./commands/run";
import { tools } from "./commands/tools/tools";
import { validateCmd } from "./commands/validate";

async function main() {
	dotenv.config({
		path: process.env.DOTENV_CONFIG_PATH,
		envKeysFile: process.env.DOTENV_KEYS_PATH ?? join(homedir(), ".dotenvx", "overlay-ts.keys"),
	});

	let cli = new Command()
		.description(`SEDA Overlay Node v${version} Command Line Interface`)
		.version(version)
		.addCommand(init)
		.addCommand(runCmd)
		.addCommand(validateCmd)
		.addCommand(identities)
		.addHelpText("after", "\r");

	if (process.env.ENABLE_DEV_TOOLS === "true") {
		cli = cli.addCommand(tools);
	}

	cli.parse(process.argv);
}

if (!isBrowser()) {
	main();
} else {
	// Browser context
}
