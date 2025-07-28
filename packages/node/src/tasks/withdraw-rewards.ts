import { createWithdrawMessageSignatureHash } from "@sedaprotocol/core-contract-schema";
import {
	type SedaChain,
	TransactionPriority,
	asyncResultToEffect,
	asyncToEffect,
	formatTokenUnits,
	vrfProve,
} from "@sedaprotocol/overlay-ts-common";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Effect } from "effect";
import { type StakerAndSeq, getStakerAndSequenceInfo } from "../../../cli/src/services/get-staker-and-sequence-info";
import type { IdentityInfo, IdentityPool } from "../models/identitiest-pool";

export const withdrawRewardsForIdentity = (
	sedaChain: SedaChain,
	identity: IdentityInfo,
	stakerInfo: StakerAndSeq,
	config: AppConfig,
) =>
	Effect.gen(function* () {
		const coreContractAddress = yield* asyncToEffect(sedaChain.getCoreContractAddress());

		const withdrawAddress = sedaChain.getSignerAddress();
		const messageHash = createWithdrawMessageSignatureHash(
			config.sedaChain.chainId,
			withdrawAddress,
			coreContractAddress,
			BigInt(stakerInfo.seq),
		);

		const proof = vrfProve(identity.privateKey, messageHash);
		yield* asyncResultToEffect(
			sedaChain.waitForSmartContractTransaction(
				{
					withdraw: {
						proof: proof.toString("hex"),
						public_key: identity.identityId,
						withdraw_address: withdrawAddress,
					},
				},
				TransactionPriority.LOW,
				undefined,
				{ gas: "auto", adjustmentFactor: config.sedaChain.gasAdjustmentFactorCosmosMessages },
				0,
				"withdrawTx",
			),
		).pipe(Effect.withSpan("withdrawTx"));
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

export const withdrawRewards = (sedaChain: SedaChain, identityPool: IdentityPool, config: AppConfig) =>
	Effect.gen(function* () {
		logger.debug("Checking if we can withdraw rewards..");

		for (const identity of identityPool.all()) {
			const stakerInfo = yield* asyncResultToEffect(getStakerAndSequenceInfo(identity.identityId, sedaChain));

			if (stakerInfo.staker.isNothing) {
				continue;
			}

			const tokensPendingWithdrawal = BigInt(stakerInfo.staker.value.tokens_pending_withdrawal);

			if (tokensPendingWithdrawal < config.sedaChain.rewardsWithdrawalMinimumThreshold) {
				logger.debug(
					`Available for withdraw: ${formatTokenUnits(tokensPendingWithdrawal)} SEDA but minimum threshold is: ${formatTokenUnits(config.sedaChain.rewardsWithdrawalMinimumThreshold)} SEDA`,
				);
				continue;
			}

			const withdrawAddress = sedaChain.getSignerAddress();
			logger.info(
				`Withdrawing ${formatTokenUnits(tokensPendingWithdrawal)} SEDA rewards to main account ${withdrawAddress}...`,
				{
					id: identity.identityId,
				},
			);

			yield* withdrawRewardsForIdentity(sedaChain, identity, stakerInfo, config);
		}
	})
		.pipe(Effect.withSpan("withdrawRewards"))
		.pipe(
			Effect.catchAll((error) => {
				logger.error(`Could not withdraw rewards: ${error}`);

				return Effect.succeed(void 0);
			}),
		);
