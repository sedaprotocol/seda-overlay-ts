import { Command } from "@commander-js/extra-typings";
import { SedaChainService, asyncResultToEffect } from "@sedaprotocol/overlay-ts-common";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { getStakers } from "@sedaprotocol/overlay-ts-node/src/services/get-staker";
import { Effect, Option } from "effect";
import { loadConfigAndSedaChain, populateWithCommonOptions } from "../../common-options";

export const availableExecutors = populateWithCommonOptions(new Command("available-executors"))
	.description("lists all available executors")
	.action(async (options) => {
		const { sedaChain, config } = await loadConfigAndSedaChain({
			config: options.config,
			mnemonic: options.mnemonic,
			network: options.network,
		});

		await Effect.runPromise(
			Effect.gen(function* () {
				const sedaChainService = yield* SedaChainService;
				const signer = sedaChainService.getSignerInfo(Option.some(0));

				logger.info(`Using RPC: ${config.sedaChain.rpc}`);
				logger.info(`Using SEDA account ${signer.address}`);
				logger.info("Listing available executors..");

				const response = yield* asyncResultToEffect(getStakers(sedaChain)).pipe(
					Effect.mapError((e) => new Error(`Listing failed: ${e}`)),
				);

				const stakers = response.map((staker) => {
					const publicKey = staker.publicKey.toString("hex");
					return {
						publicKey,
						tokensStaked: staker.tokensStaked.toString(),
						tokensPendingWithdrawal: staker.tokensPendingWithdrawal.toString(),
						memo: staker.memo.unwrapOr(Buffer.alloc(0)).toString("utf-8"),
					};
				});

				console.table(stakers);

				logger.info("Succesfully listed available executors");
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
