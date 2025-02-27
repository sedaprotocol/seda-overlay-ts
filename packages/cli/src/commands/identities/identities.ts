import { Command } from "@commander-js/extra-typings";
import { info } from "./info";
import { stake } from "./stake";

export const identities = new Command("identities")
	.description("Commands for the identities")
	.addCommand(stake)
	.addCommand(info);
