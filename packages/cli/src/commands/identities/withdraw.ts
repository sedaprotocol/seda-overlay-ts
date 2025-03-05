import { Command, Option } from "@commander-js/extra-typings";
import { populateWithCommonOptions } from "../../common-options";

export const withdraw = populateWithCommonOptions(new Command("witdraw"))
    .description("Withdraws from a certain identity")
    .argument("<number>", "Identity index to use for staking")
    .argument("<number>", "Amount to stake (a floating point number in `seda` units)")
    .addOption(new Option("--memo <string>", "memo to add to the transaction"))
    .action(async (_index, _amount, _options) => {
        // const { config, sedaChain } = await loadConfigAndSedaChain({
        // 	config: options.config,
        // 	mnemonic: options.mnemonic,
        // });

        process.exit(0);
    });
