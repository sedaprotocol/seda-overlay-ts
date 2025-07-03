import { Command } from "@commander-js/extra-typings";
import { addToAllowlist } from "./add-to-allowlist";
import { availableExecutors } from "./available-executors";
import { chainConfig } from "./chain-config";
import { executeOracleProgram } from "./execute-oracle-program";
import { multiSend } from "./multi-send";
import { pauseContract } from "./pause-contract";
import { removeFromAllowlist } from "./remove-from-allowlist";
import { send } from "./send";

export const tools = new Command("tools")
	.description("Commands for internal tools")
	.addCommand(multiSend)
	.addCommand(addToAllowlist)
	.addCommand(availableExecutors)
	.addCommand(removeFromAllowlist)
	.addCommand(executeOracleProgram)
	.addCommand(send)
	.addCommand(chainConfig)
	.addCommand(pauseContract);
