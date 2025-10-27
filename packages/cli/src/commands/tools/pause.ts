import { Command } from "@commander-js/extra-typings";
import type { EncodeObject } from "@cosmjs/proto-signing";
import { MsgPause, MsgUnpause } from "@seda-protocol/proto-messages/libs/proto-messages/gen/sedachain/core/v1/tx";
import { TransactionPriority } from "@sedaprotocol/overlay-ts-common";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { loadConfigAndSedaChain, populateWithCommonOptions } from "../../common-options";

export const pauseCoreModule = populateWithCommonOptions(new Command("pause-core-module"))
	.option("-p, --pause", "Pause the contract", false)
	.description("pauses the contract")
	.action(async (options) => {
		const { sedaChain, config } = await loadConfigAndSedaChain({
			config: options.config,
			mnemonic: options.mnemonic,
			network: options.network,
		});

		logger.info(`Using RPC: ${config.sedaChain.rpc}`);
		logger.info(`Using SEDA account ${sedaChain.getSignerAddress(0)}`);
		logger.info(`${options.pause ? "Pausing" : "Unpausing"} core module..`);

		const sender = sedaChain.getSignerAddress(0);
		let msg: EncodeObject;
		if (options.pause) {
			msg = {
				typeUrl: "/sedachain.core.v1.MsgPause",
				value: MsgPause.fromPartial({
					sender: sender,
				}),
			};
		} else {
			msg = {
				typeUrl: "/sedachain.core.v1.MsgUnpause",
				value: MsgUnpause.fromPartial({
					sender: sender,
				}),
			};
		}

		const response = await sedaChain.waitForTransaction(
			msg,
			TransactionPriority.LOW,
			{
				gas: "auto",
				adjustmentFactor: config.sedaChain.gasAdjustmentFactorCosmosMessages,
			},
			0,
			"pause-contract",
		);

		if (response.isErr) {
			logger.error(`Pausing failed: ${response.error}`);
			process.exit(1);
		}

		logger.info("Successfully paused contract");
		process.exit(0);
	});
