import { Command } from "@commander-js/extra-typings";
import { MsgRemoveFromAllowlist } from "@seda-protocol/proto-messages/libs/proto-messages/gen/sedachain/core/v1/tx";
import { TransactionPriority } from "@sedaprotocol/overlay-ts-common";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { loadConfigAndSedaChain, populateWithCommonOptions } from "../../common-options";

export const removeFromAllowlist = populateWithCommonOptions(new Command("remove-from-allowlist"))
	.description("removes an identity from the allowlist")
	.argument("<public-key>", "Hex-encoded public key to remove from the allowlist")
	.action(async (publicKey, options) => {
		const { sedaChain, config } = await loadConfigAndSedaChain({
			config: options.config,
			mnemonic: options.mnemonic,
			network: options.network,
		});

		logger.info(`Using RPC: ${config.sedaChain.rpc}`);
		logger.info(`Using SEDA account ${sedaChain.getSignerAddress(0)}`);
		logger.info(`Removing from allowlist ${publicKey}..`);

		const sender = sedaChain.getSignerAddress(0);
		const msg = {
			typeUrl: "/sedachain.core.v1.MsgRemoveFromAllowlist",
			value: MsgRemoveFromAllowlist.fromPartial({
				sender: sender,
				publicKey: publicKey,
			}),
		};

		const response = await sedaChain.waitForTransaction(
			msg,
			TransactionPriority.LOW,
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
