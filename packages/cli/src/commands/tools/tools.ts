import { Command } from "@commander-js/extra-typings";
import { addToAllowlist } from "./add-to-allowlist";
import { availableExecutors } from "./available-executors";
import { executeOracleProgram } from "./execute-oracle-program";
import { removeFromAllowlist } from "./remove-from-allowlist";

export const tools = new Command("tools")
	.description("Commands for internal tools")
	.addCommand(addToAllowlist)
	.addCommand(availableExecutors)
	.addCommand(removeFromAllowlist)
	.addCommand(executeOracleProgram);
