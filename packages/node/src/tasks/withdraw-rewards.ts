import { MsgWithdraw } from "@seda-protocol/proto-messages/libs/proto-messages/gen/sedachain/core/v1/tx";
import { createWithdrawMessageSignatureHash } from "@sedaprotocol/core-contract-schema";
import {
	type SedaChain,
	TransactionPriority,
	asyncResultToEffect,
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
		const withdrawAddress = sedaChain.getSignerAddress();
		const messageHash = createWithdrawMessageSignatureHash(
			config.sedaChain.chainId,
			withdrawAddress,
			BigInt(stakerInfo.seq),
		);

		const proof = vrfProve(identity.privateKey, messageHash);

		const sender = sedaChain.getSignerAddress(0);
		const withdrawMsg = {
			typeUrl: "/sedachain.core.v1.MsgWithdraw",
			value: MsgWithdraw.fromPartial({
				sender: sender,
				publicKey: identity.identityId,
				proof: proof.toString("hex"),
				withdrawAddress: withdrawAddress,
			}),
		};

		yield* asyncResultToEffect(
			sedaChain.waitForTransaction(
				withdrawMsg,
				TransactionPriority.LOW,
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

			const tokensPendingWithdrawal = BigInt(stakerInfo.staker.value.pendingWithdrawal);

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
