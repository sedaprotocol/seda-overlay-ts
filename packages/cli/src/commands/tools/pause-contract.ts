import { Command } from "@commander-js/extra-typings";
import type { ExecuteMsg } from "@sedaprotocol/core-contract-schema";
import { SedaChainService, TransactionPriority } from "@sedaprotocol/overlay-ts-common";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Effect, Option } from "effect";
import { loadConfigAndSedaChain, populateWithCommonOptions } from "../../common-options";

export const pauseContract = populateWithCommonOptions(new Command("pause-contract"))
	.option("-p, --pause", "Pause the contract", false)
	.description("pauses the contract")
	.action(async (options) => {
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
				logger.info(`${options.pause ? "Pausing" : "Unpausing"} contract..`);

				const pauseOrUnpause: ExecuteMsg = options.pause ? { pause: {} } : { unpause: {} };

				yield* sedaChain
					.queueSmartContractMessage(
						"pause-contract",
						[
							{
								message: pauseOrUnpause,
								attachedAttoSeda: Option.none(),
							},
						],
						TransactionPriority.LOW,
						signer,
						Option.some({
							gas: "auto",
							adjustmentFactor: config.sedaChain.gasAdjustmentFactorCosmosMessages,
						}),
					)
					.pipe(Effect.mapError((e) => new Error(`Pausing failed: ${e}`)));

				logger.info("Successfully paused contract");
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
