import { Option as CliOption, Command } from "@commander-js/extra-typings";
import { createStakeMessageSignatureHash } from "@sedaprotocol/core-contract-schema";
import {
	SedaChainService,
	TransactionPriority,
	formatTokenUnits,
	parseTokenUnits,
	vrfProve,
} from "@sedaprotocol/overlay-ts-common";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Effect, Option } from "effect";
import { Maybe } from "true-myth";
import { loadConfigAndSedaChain, populateWithCommonOptions } from "../../common-options";
import { getStakerAndSequenceInfo } from "../../services/get-staker-and-sequence-info";

export const stake = populateWithCommonOptions(new Command("stake"))
	.description("stakes on a certain identity")
	.argument("<seda-amount>", "Amount to stake (a floating point number in `seda` units)")
	.addOption(new CliOption("--memo <string>", "memo to add to the transaction"))
	.addOption(new CliOption("-i, --identity-index <number>", "Identity index to use for staking").default(0))
	.action(async (amount, options) => {
		const index = options.identityIndex;
		const memo = Maybe.of(options.memo).map((value) => Buffer.from(value));
		const attoSedaAmount = BigInt(parseTokenUnits(amount));

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

				stakerInfo.staker.pipe(
					Option.match({
						onSome: (staker) => {
							const staked = formatTokenUnits(staker.tokens_staked);
							const pendingWithdrawl = formatTokenUnits(staker.tokens_pending_withdrawal);

							logger.info(
								`Identity ${identityId.value} already registered (staked: ${staked} SEDA, pending_withdrawal: ${pendingWithdrawl} SEDA).`,
							);
						},
						onNone: () => {
							logger.info(`Registering new Identity (index "${index}") with stake ${amount} SEDA.`);
						},
					}),
				);

				const messageHash = createStakeMessageSignatureHash(
					config.sedaChain.chainId,
					coreContractAddress,
					stakerInfo.seq,
					memo,
				);

				logger.info(`Staking on identity ${identityId.value} with ${amount} SEDA (or ${attoSedaAmount} aSEDA)`);

				const proof = vrfProve(privateKey.value, messageHash);
				yield* sedaChain
					.queueSmartContractMessage(
						"stake",
						[
							{
								attachedAttoSeda: Option.some(attoSedaAmount),
								message: {
									stake: {
										public_key: identityId.value,
										proof: proof.toString("hex"),
										memo: memo.map((v) => v.toString("base64")).unwrapOr(null),
									},
								},
							},
						],
						TransactionPriority.LOW,
						signer,
						Option.some({ gas: "auto", adjustmentFactor: config.sedaChain.gasAdjustmentFactorCosmosMessages }),
					)
					.pipe(Effect.mapError((e) => new Error(`Staking failed: ${e}`)));

				logger.info("Successfully staked");
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
