import { Command } from "@commander-js/extra-typings";
import { SedaChainService, TransactionPriority } from "@sedaprotocol/overlay-ts-common";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Effect, Option } from "effect";
import { loadConfigAndSedaChain, populateWithCommonOptions } from "../../common-options";

export const addToAllowlist = populateWithCommonOptions(new Command("add-to-allowlist"))
	.description("adds an identity to the allowlist")
	.argument("<identity-index>", "Identity public key you want to add")
	.action(async (identityId, options) => {
		const { sedaChain, config } = await loadConfigAndSedaChain({
			config: options.config,
			mnemonic: options.mnemonic,
			network: options.network,
		});

		await Effect.runPromise(
			Effect.gen(function* () {
				const sedaChain = yield* SedaChainService;
				const singer = sedaChain.getSignerInfo(Option.some(0));

				logger.info(`Using RPC: ${config.sedaChain.rpc}`);
				logger.info(`Adding to allowlist ${identityId}..`);
				logger.info(`Using SEDA account ${singer.address}`);

				yield* sedaChain
					.queueSmartContractMessage(
						"add-to-allowlist",
						[
							{
								attachedAttoSeda: Option.none(),
								message: {
									add_to_allowlist: {
										public_key: identityId,
									},
								},
							},
						],
						TransactionPriority.LOW,
						singer,
						Option.some({ gas: "auto", adjustmentFactor: config.sedaChain.gasAdjustmentFactorCosmosMessages }),
					)
					.pipe(Effect.mapError((e) => new Error(`Adding failed: ${e}`)));

				logger.info("Successfully added to allowlist");
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
