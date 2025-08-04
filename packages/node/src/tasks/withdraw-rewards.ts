import { createWithdrawMessageSignatureHash } from "@sedaprotocol/core-contract-schema";
import { SedaChainService, TransactionPriority, formatTokenUnits, vrfProve } from "@sedaprotocol/overlay-ts-common";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Effect, Option } from "effect";
import { type StakerAndSeq, getStakerAndSequenceInfo } from "../../../cli/src/services/get-staker-and-sequence-info";
import type { IdentityInfo, IdentityPool } from "../models/identitiest-pool";

export const withdrawRewardsForIdentity = (identity: IdentityInfo, stakerInfo: StakerAndSeq, config: AppConfig) =>
	Effect.gen(function* () {
		const sedaChain = yield* SedaChainService;
		const coreContractAddress = yield* sedaChain.getCoreContractAddress();
		const withdrawSigner = sedaChain.getSignerInfo(Option.some(0));

		const messageHash = createWithdrawMessageSignatureHash(
			config.sedaChain.chainId,
			withdrawSigner.address,
			coreContractAddress,
			BigInt(stakerInfo.seq),
		);

		const proof = vrfProve(identity.privateKey, messageHash);
		yield* sedaChain
			.queueSmartContractMessage(
				"withdrawTx",
				[
					{
						attachedAttoSeda: Option.none(),
						message: {
							withdraw: {
								proof: proof.toString("hex"),
								public_key: identity.identityId,
								withdraw_address: withdrawSigner.address,
							},
						},
					},
				],
				TransactionPriority.LOW,
				withdrawSigner,
				Option.some({ gas: "auto", adjustmentFactor: config.sedaChain.gasAdjustmentFactorCosmosMessages }),
			)
			.pipe(Effect.withSpan("withdrawTx"));
	})
		.pipe(Effect.withSpan("withdrawRewardsForIdentity"))
		.pipe(
			Effect.catchAll((error) => {
				logger.error(`Error while withdrawing for identity: ${error}`, {
					id: identity.identityId,
				});

				return Effect.succeed(void 0);
			}),
		);

export const withdrawRewards = (identityPool: IdentityPool, config: AppConfig) =>
	Effect.gen(function* () {
		const sedaChain = yield* SedaChainService;

		logger.debug("Checking if we can withdraw rewards..");

		for (const identity of identityPool.all()) {
			const stakerInfo = yield* getStakerAndSequenceInfo(identity.identityId);

			if (Option.isNone(stakerInfo.staker)) {
				continue;
			}

			const tokensPendingWithdrawal = BigInt(stakerInfo.staker.value.tokens_pending_withdrawal);

			if (tokensPendingWithdrawal < config.sedaChain.rewardsWithdrawalMinimumThreshold) {
				logger.debug(
					`Available for withdraw: ${formatTokenUnits(tokensPendingWithdrawal)} SEDA but minimum threshold is: ${formatTokenUnits(config.sedaChain.rewardsWithdrawalMinimumThreshold)} SEDA`,
				);
				continue;
			}

			const withdrawAddress = sedaChain.getSignerInfo(Option.some(0));
			logger.info(
				`Withdrawing ${formatTokenUnits(tokensPendingWithdrawal)} SEDA rewards to main account ${withdrawAddress.address}...`,
				{
					id: identity.identityId,
				},
			);

			yield* withdrawRewardsForIdentity(identity, stakerInfo, config);
		}
	})
		.pipe(Effect.withSpan("withdrawRewards"))
		.pipe(
			Effect.catchAll((error) => {
				logger.error(`Could not withdraw rewards: ${error}`);

				return Effect.succeed(void 0);
			}),
		);
