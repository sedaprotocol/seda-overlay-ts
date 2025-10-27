import { Command } from "@commander-js/extra-typings";
import { MsgAddToAllowlist } from "@seda-protocol/proto-messages/libs/proto-messages/gen/sedachain/core/v1/tx";
import { TransactionPriority } from "@sedaprotocol/overlay-ts-common";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { loadConfigAndSedaChain, populateWithCommonOptions } from "../../common-options";

export const addToAllowlist = populateWithCommonOptions(new Command("add-to-allowlist"))
	.description("adds an identity to the allowlist")
	.argument("<public-key>", "Hex-encoded public key to add to the allowlist")
	.action(async (publicKey, options) => {
		const { sedaChain, config } = await loadConfigAndSedaChain({
			config: options.config,
			mnemonic: options.mnemonic,
			network: options.network,
		});

		logger.info(`Using RPC: ${config.sedaChain.rpc}`);
		logger.info(`Adding to allowlist ${publicKey}..`);
		logger.info(`Using SEDA account ${sedaChain.getSignerAddress(0)}`);

		const sender = sedaChain.getSignerAddress(0);
		const addToAllowlistMsg = {
			typeUrl: "/sedachain.core.v1.MsgAddToAllowlist",
			value: MsgAddToAllowlist.fromPartial({
				sender: sender,
				publicKey: publicKey,
			}),
		};

		const response = await sedaChain.waitForTransaction(
			addToAllowlistMsg,
			TransactionPriority.LOW,
			{ gas: "auto", adjustmentFactor: config.sedaChain.gasAdjustmentFactorCosmosMessages },
			0,
			"add-to-allowlist",
		);

		if (response.isErr) {
			logger.error(`Adding failed: ${response.error}`);
			process.exit(1);
		}

		logger.info("Successfully added to allowlist");
		process.exit(0);
	});
