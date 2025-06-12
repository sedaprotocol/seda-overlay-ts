import { Command } from "@commander-js/extra-typings";
import { GasPrice } from "@cosmjs/stargate";
import { parseTokenUnits } from "@sedaprotocol/overlay-ts-common";
import { DEFAULT_GAS_PRICE } from "@sedaprotocol/overlay-ts-config/src/constants";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { loadConfigAndSedaChain, populateWithCommonOptions } from "../../common-options";

export const multiSend = populateWithCommonOptions(new Command("multi-send"))
	.description("sends SEDA to all your SEDA addresses")
	.option("-a, --amount <amount>", "Amount of SEDA to send", "1")
	.action(async (options) => {
		const amountToSend = parseTokenUnits(options.amount, 18);
		const { sedaChain } = await loadConfigAndSedaChain({
			config: options.config,
			mnemonic: options.mnemonic,
			network: options.network,
		});

		const sender = sedaChain.getSignerAddress(0);
		// @ts-ignore
		sedaChain.signerClients[0].gasPrice = GasPrice.fromString(`${DEFAULT_GAS_PRICE}aseda`);

		for (const [accountIndex, _] of sedaChain.signerClients.entries()) {
			if (accountIndex === 0) continue;

			await sedaChain.signerClients[0].sendTokens(
				sender,
				sedaChain.getSignerAddress(accountIndex),
				[
					{
						denom: "aseda",
						amount: amountToSend,
					},
				],
				"auto",
			);

			logger.info(`Sent ${options.amount} SEDA to ${sedaChain.getSignerAddress(accountIndex)}`);
		}

		logger.info("Successfully sent SEDA to multiple accounts");
		process.exit(0);
	});
