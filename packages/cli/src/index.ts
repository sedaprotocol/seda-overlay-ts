import { Command } from "@commander-js/extra-typings";
import { isBrowser } from "@sedaprotocol/overlay-ts-common";
import { version } from "../package.json";
import { identities } from "./commands/identities/identities";
import { init } from "./commands/init";
import { run } from "./commands/run";
import { tools } from "./commands/tools/tools";

async function main() {
	let cli = new Command()
		.description("SEDA Overlay Node TypeScript Command Line Interface")
		.version(version)
		.addCommand(init)
		.addCommand(run)
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
