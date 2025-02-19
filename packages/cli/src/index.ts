import { Command } from "@commander-js/extra-typings";
import { isBrowser } from "@sedaprotocol/overlay-ts-common";
import { version } from "../package.json";
import { identities } from "./commands/identities/identities";
import { init } from "./commands/init";
import { run } from "./commands/run";

async function main() {
	const cli = new Command()
		.description("SEDA Overlay Node TypeScript Command Line Interface")
		.version(version)
		.addCommand(init)
		.addCommand(run)
		.addCommand(identities)
		.addHelpText("after", "\r");

	cli.parse(process.argv);
}

if (!isBrowser()) {
	main();
} else {
	// Browser context
}
