import { Command } from "@commander-js/extra-typings";
import { SedaChainService, TransactionPriority } from "@sedaprotocol/overlay-ts-common";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Effect, Option } from "effect";
import { loadConfigAndSedaChain, populateWithCommonOptions } from "../../common-options";

export const removeFromAllowlist = populateWithCommonOptions(new Command("remove-from-allowlist"))
	.description("removes an identity from the allowlist")
	.argument("<identity-index>", "Identity public key you want to remove")
	.action(async (identityId, options) => {
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
				logger.info(`Removing from allowlist ${identityId}..`);

				yield* sedaChain
					.queueSmartContractMessage(
						"remove-from-allowlist",
						[
							{
								attachedAttoSeda: Option.none(),
								message: {
									remove_from_allowlist: {
										public_key: identityId,
									},
								},
							},
						],
						TransactionPriority.LOW,
						signer,
						Option.some({ gas: "auto", adjustmentFactor: config.sedaChain.gasAdjustmentFactorCosmosMessages }),
					)
					.pipe(Effect.mapError((e) => new Error(`Removing failed: ${e}`)));

				logger.info("Successfully removed from allowlist");
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
