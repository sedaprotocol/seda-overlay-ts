import { Command } from "@commander-js/extra-typings";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { loadConfigAndSedaChain, populateWithCommonOptions } from "../../common-options";
import { TransactionPriority } from "@sedaprotocol/overlay-ts-common";

export const addToAllowlist = populateWithCommonOptions(new Command("add-to-allowlist"))
	.description("adds an identity to the allowlist")
	.argument("<identity-index>", "Identity public key you want to add")
	.action(async (identityId, options) => {
		const { sedaChain, config } = await loadConfigAndSedaChain({
			config: options.config,
			mnemonic: options.mnemonic,
			network: options.network,
		});

		logger.info(`Using RPC: ${config.sedaChain.rpc}`);
		logger.info(`Adding to allowlist ${identityId}..`);
		logger.info(`Using SEDA account ${sedaChain.getSignerAddress(0)}`);

		const response = await sedaChain.waitForSmartContractTransaction({
			add_to_allowlist: {
				public_key: identityId,
			},
		}, TransactionPriority.LOW, undefined, undefined, 0, "add-to-allowlist");

		if (response.isErr) {
			logger.error(`Adding failed: ${response.error}`);
			process.exit(1);
		}

		logger.info("Successfully added to allowlist");
		process.exit(0);
	});
