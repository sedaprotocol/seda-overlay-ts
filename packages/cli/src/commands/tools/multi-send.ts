import { Command } from "@commander-js/extra-typings";
import { TransactionPriority, parseTokenUnits } from "@sedaprotocol/overlay-ts-common";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { loadConfigAndSedaChain, populateWithCommonOptions } from "../../common-options";

export const multiSend = populateWithCommonOptions(new Command("multi-send"))
	.description("sends SEDA to all your SEDA addresses, takes the mnemonic and derives all the addresses")
	.option("-a, --amount <amount>", "Amount of SEDA to send", "1")
	.action(async (options) => {
		const amountToSend = parseTokenUnits(options.amount, 18);
		const { sedaChain, config } = await loadConfigAndSedaChain({
			config: options.config,
			mnemonic: options.mnemonic,
			network: options.network,
		});

		logger.info(`Using RPC: ${config.sedaChain.rpc}`);
		logger.info(`Using SEDA account ${sedaChain.getSignerAddress(0)}`);

		const sender = sedaChain.getSignerAddress(0);

		for (const [accountIndex, _] of sedaChain.signerClients.entries()) {
			// We should not send to ourselves
			if (accountIndex === 0) continue;

			const sendMsg = {
				typeUrl: "/cosmos.bank.v1beta1.MsgSend",
				value: {
					fromAddress: sender,
					toAddress: sedaChain.getSignerAddress(accountIndex),
					amount: [
						{
							denom: "aseda",
							amount: amountToSend,
						},
					],
				},
			};

			await sedaChain.queueCosmosMessage(sendMsg, TransactionPriority.LOW, undefined, 0);

			logger.info(`Sent ${options.amount} SEDA to ${sedaChain.getSignerAddress(accountIndex)}`);
		}

		logger.info("Successfully sent SEDA to multiple accounts");
		process.exit(0);
	});
