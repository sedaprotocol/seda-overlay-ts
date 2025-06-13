import { Command } from "@commander-js/extra-typings";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { loadConfigAndSedaChain, populateWithCommonOptions } from "../../common-options";
import { TransactionPriority } from "@sedaprotocol/overlay-ts-common";

export const removeFromAllowlist = populateWithCommonOptions(new Command("remove-from-allowlist"))
	.description("removes an identity from the allowlist")
	.argument("<identity-index>", "Identity public key you want to remove")
	.action(async (identityId, options) => {
		const { sedaChain } = await loadConfigAndSedaChain({
			config: options.config,
			mnemonic: options.mnemonic,
			network: options.network,
		});

		logger.info(`Removing from allowlist ${identityId}..`);

		const response = await sedaChain.waitForSmartContractTransaction({
			remove_from_allowlist: {
				public_key: identityId,
			},
		}, TransactionPriority.LOW, undefined, undefined, 0, "remove-from-allowlist");

		if (response.isErr) {
			logger.error(`Removing failed: ${response.error}`);
			process.exit(1);
		}

		logger.info("Successfully removed from allowlist");
		process.exit(0);
	});
