import { Command } from "@commander-js/extra-typings";
import { SedaChain } from "@sedaprotocol/overlay-ts-common";
import { loadConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Maybe } from "true-myth";
import { populateWithCommonOptions } from "../../common-options";

export const stake = populateWithCommonOptions(new Command("stake"))
	.description("stakes on a certain identity")
	.argument("<number>", "Identity index to use for staking")
	.argument("<number>", "Amount to stake (a floating point number in `seda` units)")
	.action(async (index, _amount, options) => {
		const config = await loadConfig(options.config, {
			sedaChain: {
				mnemonic: options.mnemonic,
			},
		});

		if (config.isErr) {
			logger.error("Error while parsing config:");

			for (const error of config.error) {
				logger.error(error);
			}
			process.exit(1);
		}

		const sedaChain = await SedaChain.fromConfig(config.value);

		if (sedaChain.isErr) {
			logger.error(`Could not create SEDA chain instance: ${sedaChain.error}`);
			process.exit(1);
		}

		const identities = Array.from(config.value.sedaChain.identities.entries());
		const identity = Maybe.of(identities.at(Number(index)));

		if (identity.isNothing) {
			logger.error(`Identity with index "${index}" does not exist`);
			process.exit(1);
		}
	});
