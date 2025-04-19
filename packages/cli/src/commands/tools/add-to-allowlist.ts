import { Command } from "@commander-js/extra-typings";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { loadConfigAndSedaChain, populateWithCommonOptions } from "../../common-options";

export const addToAllowlist = populateWithCommonOptions(new Command("add-to-allowlist"))
	.description("stakes on a certain identity")
	.argument("<identity-index>", "Identity public key you want to add")
	.action(async (identityId, options) => {
		const { sedaChain } = await loadConfigAndSedaChain({
			config: options.config,
			mnemonic: options.mnemonic,
			network: options.network,
		});

		logger.info(`Adding to allowlist ${identityId}..`);

        const response = await sedaChain.waitForSmartContractTransaction({
			add_to_allowlist: {
				public_key: identityId,
			},
		});

		if (response.isErr) {
			logger.error(`Adding failed: ${response.error}`);
			process.exit(1);
		}

		logger.info("Succesfully added to allowlist");
		process.exit(0);
	});
