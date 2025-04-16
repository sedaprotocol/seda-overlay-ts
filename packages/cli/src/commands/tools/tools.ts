import { Command } from "@commander-js/extra-typings";
import { addToAllowlist } from "./add-to-allowlist";

export const tools = new Command("tools").description("Commands for internal tools").addCommand(addToAllowlist);
