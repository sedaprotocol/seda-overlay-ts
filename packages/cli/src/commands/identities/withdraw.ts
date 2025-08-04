import { Option as CliOption, Command } from "@commander-js/extra-typings";
import { createWithdrawMessageSignatureHash } from "@sedaprotocol/core-contract-schema/src/identity";
import { SedaChainService, TransactionPriority, formatTokenUnits, vrfProve } from "@sedaprotocol/overlay-ts-common";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Effect, Option } from "effect";
import { Maybe } from "true-myth";
import { loadConfigAndSedaChain, populateWithCommonOptions } from "../../common-options";
import { getStakerAndSequenceInfo } from "../../services/get-staker-and-sequence-info";

export const withdraw = populateWithCommonOptions(new Command("withdraw"))
	.description("Withdraws from a certain identity")
	.addOption(new CliOption("-i, --identity-index <number>", "Identity index to use for withdrawing").default(0))
	.addOption(new CliOption("--memo <string>", "memo to add to the transaction"))
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
				if (BigInt(staker.tokens_pending_withdrawal) === 0n) {
					logger.error(`Cannot withdraw because identity has no pending withdraw (index ${index}).`);
					process.exit(1);
				}

				const messageHash = createWithdrawMessageSignatureHash(
					config.sedaChain.chainId,
					signer.address,
					coreContractAddress,
					stakerInfo.seq,
				);

				const proof = vrfProve(privateKey.value, messageHash);
				logger.info(`Withdrawing ${formatTokenUnits(staker.tokens_pending_withdrawal)} SEDA...`);

				yield* sedaChain
					.queueSmartContractMessage(
						"withdraw",
						[
							{
								attachedAttoSeda: Option.none(),
								message: {
									withdraw: {
										proof: proof.toString("hex"),
										public_key: identityId.value,
										withdraw_address: signer.address,
									},
								},
							},
						],
						TransactionPriority.LOW,
						signer,
						Option.some({ gas: "auto", adjustmentFactor: config.sedaChain.gasAdjustmentFactorCosmosMessages }),
					)
					.pipe(Effect.mapError((e) => new Error(`Unstaking failed: ${e}`)));

				logger.info("Successfully withdrawn");
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
