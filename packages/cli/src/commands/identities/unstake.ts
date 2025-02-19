import { Command, Option } from "@commander-js/extra-typings";
import { loadConfigAndSedaChain, populateWithCommonOptions } from "../../common-options";

export const unstake = populateWithCommonOptions(new Command("stake"))
    .description("stakes on a certain identity")
    .argument("<number>", "Identity index to use for staking")
    .argument("<number>", "Amount to stake (a floating point number in `seda` units)")
    .addOption(new Option("--memo <string>", "memo to add to the transaction"))
    .action(async (index, amount, options) => {
        const { config, sedaChain } = await loadConfigAndSedaChain({
            config: options.config,
            mnemonic: options.mnemonic,
        });


        process.exit(0);
    });