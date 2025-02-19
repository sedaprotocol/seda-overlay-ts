import { Command } from "@commander-js/extra-typings";
import { stake } from "./stake";

export const identities = new Command("identities").description("Commands for the identities").addCommand(stake);
