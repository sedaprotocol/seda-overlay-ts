import { Command } from "@commander-js/extra-typings";
import { TransactionPriority } from "@sedaprotocol/overlay-ts-common";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { loadConfigAndSedaChain, populateWithCommonOptions } from "../../common-options";

export const removeFromAllowlist = populateWithCommonOptions(new Command("remove-from-allowlist"))
	.description("removes an identity from the allowlist")
	.argument("<identity-index>", "Identity public key you want to remove")
	.action(async (identityId, options) => {
		const { sedaChain, config } = await loadConfigAndSedaChain({
			config: options.config,
			mnemonic: options.mnemonic,
			network: options.network,
		});

		logger.info(`Using RPC: ${config.sedaChain.rpc}`);
		logger.info(`Using SEDA account ${sedaChain.getSignerAddress(0)}`);
		logger.info(`Removing from allowlist ${identityId}..`);

		const response = await sedaChain.waitForSmartContractTransaction(
			{
				remove_from_allowlist: {
					public_key: identityId,
				},
			},
			TransactionPriority.LOW,
			undefined,
			{ gas: "auto", adjustmentFactor: config.sedaChain.gasAdjustmentFactorCosmosMessages },
			0,
			"remove-from-allowlist",
		);

		if (response.isErr) {
			logger.error(`Removing failed: ${response.error}`);
			process.exit(1);
		}

		logger.info("Successfully removed from allowlist");
		process.exit(0);
	});
