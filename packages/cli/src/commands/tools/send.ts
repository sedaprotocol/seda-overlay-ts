import { Command } from "@commander-js/extra-typings";
import { SedaChainService, TransactionPriority, parseTokenUnits } from "@sedaprotocol/overlay-ts-common";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Effect, Option } from "effect";
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

		await Effect.runPromise(
			Effect.gen(function* () {
				const sedaChain = yield* SedaChainService;
				const signer = sedaChain.getSignerInfo(Option.some(0));

				logger.info(`Using RPC: ${config.sedaChain.rpc}`);
				logger.info(`Using SEDA account ${signer.address}`);

				const sendMsg = {
					typeUrl: "/cosmos.bank.v1beta1.MsgSend",
					value: {
						fromAddress: signer.address,
						toAddress: destination,
						amount: [
							{
								denom: "aseda",
								amount: amountToSend,
							},
						],
					},
				};

				yield* sedaChain.queueMessage(
					"send",
					[sendMsg],
					TransactionPriority.LOW,
					signer,
					Option.some({
						gas: "auto",
						adjustmentFactor: config.sedaChain.gasAdjustmentFactorCosmosMessages,
					}),
				);

				logger.info(`Sent ${amount} SEDA to ${destination}`);
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
