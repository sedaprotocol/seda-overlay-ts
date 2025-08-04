import { Command } from "@commander-js/extra-typings";
import { SedaChainService, TransactionPriority, parseTokenUnits } from "@sedaprotocol/overlay-ts-common";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Effect, Option } from "effect";
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

		await Effect.runPromise(
			Effect.gen(function* () {
				const sedaChain = yield* SedaChainService;
				const mainSigner = sedaChain.getSignerInfo(Option.some(0));

				logger.info(`Using RPC: ${config.sedaChain.rpc}`);
				logger.info(`Using SEDA account ${mainSigner.address}`);

				const allSigners = yield* sedaChain.getAllSigners();

				for (const signer of allSigners) {
					// We should not send to ourselves
					if (signer.accountIndex === 0) continue;

					const sendMsg = {
						typeUrl: "/cosmos.bank.v1beta1.MsgSend",
						value: {
							fromAddress: mainSigner.address,
							toAddress: signer.address,
							amount: [
								{
									denom: "aseda",
									amount: amountToSend,
								},
							],
						},
					};

					yield* sedaChain.queueMessage("multi-send", [sendMsg], TransactionPriority.LOW, mainSigner, Option.none());

					logger.info(`Sent ${options.amount} SEDA to ${signer.address}`);
				}

				logger.info("Successfully sent SEDA to multiple accounts");
				process.exit(0);
			})
				.pipe(Effect.provide(sedaChain))
				.pipe(
					Effect.catchAll((error) => {
						logger.error(`${error}`);
						process.exit(1);

						return Effect.succeed(void 0);
					}),
				),
		);
	});
