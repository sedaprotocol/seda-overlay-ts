import { Command } from "@commander-js/extra-typings";
import { TransactionPriority, parseTokenUnits } from "@sedaprotocol/overlay-ts-common";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { loadConfigAndSedaChain, populateWithCommonOptions } from "../../common-options";

export const send = populateWithCommonOptions(new Command("send"))
	.description("sends SEDA to a destination address")
	.argument("<destination>", "Destination address")
	.argument("<amount>", "Amount of SEDA to send")
	.action(async (destination, amount, options) => {
		const amountToSend = parseTokenUnits(amount, 18);
		const { sedaChain, config } = await loadConfigAndSedaChain({
			config: options.config,
			mnemonic: options.mnemonic,
			network: options.network,
		});

		logger.info(`Using RPC: ${config.sedaChain.rpc}`);
		logger.info(`Using SEDA account ${sedaChain.getSignerAddress(0)}`);

		const sender = sedaChain.getSignerAddress(0);
		const sendMsg = {
			typeUrl: "/cosmos.bank.v1beta1.MsgSend",
			value: {
				fromAddress: sender,
				toAddress: destination,
				amount: [
					{
						denom: "aseda",
						amount: amountToSend,
					},
				],
			},
		};

		await sedaChain.queueCosmosMessage(
			sendMsg,
			TransactionPriority.LOW,
			{
				gas: "auto",
				adjustmentFactor: config.sedaChain.gasAdjustmentFactorCosmosMessages,
			},
			0,
		);

		logger.info(`Sent ${amount} SEDA to ${destination}`);
		process.exit(0);
	});
