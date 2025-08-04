import { Option as CliOption, Command } from "@commander-js/extra-typings";
import { createUnstakeMessageSignatureHash } from "@sedaprotocol/core-contract-schema";
import { SedaChainService, TransactionPriority, formatTokenUnits, vrfProve } from "@sedaprotocol/overlay-ts-common";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Effect, Option } from "effect";
import { Maybe } from "true-myth";
import { loadConfigAndSedaChain, populateWithCommonOptions } from "../../common-options";
import { getStakerAndSequenceInfo } from "../../services/get-staker-and-sequence-info";

export const unstake = populateWithCommonOptions(new Command("unstake"))
	.description("Unstakes the entire stake from a certain identity")
	.addOption(new CliOption("--memo <string>", "memo to add to the transaction"))
	.addOption(new CliOption("-i, --identity-index <number>", "Identity index to use for unstaking").default(0))
	.action(async (options) => {
		const index = options.identityIndex;
		const { config, sedaChain } = await loadConfigAndSedaChain({
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

				const identityId = Maybe.of(config.sedaChain.identityIds.at(Number(index)));

				if (identityId.isNothing) {
					logger.error(`Identity with index "${index}" does not exist`);
					process.exit(1);
				}

				const privateKey: Maybe<Buffer> = Maybe.of(config.sedaChain.identities.get(identityId.value));

				if (privateKey.isNothing) {
					logger.error(`Identity with index "${index}" does not exist`);
					process.exit(1);
				}

				const coreContractAddress = yield* sedaChain.getCoreContractAddress();
				const stakerInfo = yield* getStakerAndSequenceInfo(identityId.value).pipe(
					Effect.mapError((e) => new Error(`Could not fetch sequence: ${e}`)),
				);

				if (Option.isNone(stakerInfo.staker)) {
					logger.error(`Cannot unstake because identity is not registered (index ${index}).`);
					process.exit(1);
				}

				const staker = stakerInfo.staker.value;

				const staked = formatTokenUnits(staker.tokens_staked);
				const pendingWithdrawl = formatTokenUnits(staker.tokens_pending_withdrawal);

				logger.info(
					`Identity ${identityId.value} (staked: ${staked} SEDA, pending_withdrawal: ${pendingWithdrawl} SEDA).`,
				);

				const messageHash = createUnstakeMessageSignatureHash(
					config.sedaChain.chainId,
					coreContractAddress,
					stakerInfo.seq,
				);

				const proof = vrfProve(privateKey.value, messageHash);
				logger.info(`Unstaking ${formatTokenUnits(staker.tokens_staked)} SEDA...`);

				yield* sedaChain
					.queueSmartContractMessage(
						"unstake",
						[
							{
								attachedAttoSeda: Option.none(),
								message: {
									unstake: {
										proof: proof.toString("hex"),
										public_key: identityId.value,
									},
								},
							},
						],
						TransactionPriority.LOW,
						signer,
						Option.some({ gas: "auto", adjustmentFactor: config.sedaChain.gasAdjustmentFactorCosmosMessages }),
					)
					.pipe(Effect.mapError((e) => new Error(`Unstaking failed: ${e}`)));

				logger.info("Successfully unstaked");
				process.exit(0);
			}).pipe(
				Effect.provide(sedaChain),
				Effect.catchAll((error) => {
					logger.error(`${error}`);
					process.exit(1);

					return Effect.succeed(void 0);
				}),
			),
		);
	});
