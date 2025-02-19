import { Command } from "@commander-js/extra-typings";
import { stake } from "./stake";
import { info } from "./info";

export const identities = new Command("identities").description("Commands for the identities").addCommand(stake).addCommand(info);
