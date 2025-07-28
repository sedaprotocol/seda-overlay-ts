import { type SedaChain, TransactionPriority, asyncResultToEffect } from "@sedaprotocol/overlay-ts-common";
import { formatTokenUnits } from "@sedaprotocol/overlay-ts-common";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Effect } from "effect";

/**
 * Making sure all accounts have at least the minimum SEDA amount
 * This is to be able to execute transactions on the chain. Not alot is needed since the chain refunds succesfully executed transactions.
 */
export const sendSedaToSubAccounts = (sedaChain: SedaChain, config: AppConfig) =>
	Effect.gen(function* () {
		// We only want to send tokens from the first account
		const sender = sedaChain.getSignerAddress(0);

		// First we need to make sure the first account has enough tokens
		const balance = yield* asyncResultToEffect(sedaChain.getBalance(0));

		logger.debug(`${sender} has ${formatTokenUnits(balance.amount)} SEDA`);

		// We want to maintain atleast twice the minimum SEDA per account
		// This is to fully drain the first account
		if (BigInt(balance.amount) < config.sedaChain.minSedaPerAccount * 2n) {
			logger.error(
				`Not enough SEDA to send to sub accounts, SEDA address: ${sender} has less than ${formatTokenUnits(config.sedaChain.minSedaPerAccount * 2n)} SEDA`,
			);

			return yield* Effect.fail(new Error("Not enough SEDA to send to sub accounts"));
		}

		for (const [accountIndex, _] of sedaChain.signerClients.entries()) {
			// We don't want to send tokens to the first account (itself)
			if (accountIndex === 0) continue;

			const balance = yield* asyncResultToEffect(sedaChain.getBalance(accountIndex));

			if (BigInt(balance.amount) >= config.sedaChain.minSedaPerAccount) {
				logger.debug(
					`${accountIndex}: Account ${sedaChain.getSignerAddress(accountIndex)} has enough SEDA (min: ${formatTokenUnits(config.sedaChain.minSedaPerAccount)} SEDA, current: ${formatTokenUnits(balance.amount)} SEDA)`,
				);
				continue;
			}

			logger.info(
				`${accountIndex}: Account ${sedaChain.getSignerAddress(accountIndex)} has less than the minimum SEDA amount. Sending ${formatTokenUnits(config.sedaChain.minSedaPerAccount)} SEDA..`,
			);

			const sendMsg = {
				typeUrl: "/cosmos.bank.v1beta1.MsgSend",
				value: {
					fromAddress: sender,
					toAddress: sedaChain.getSignerAddress(accountIndex),
					amount: [
						{
							denom: "aseda",
							amount: config.sedaChain.minSedaPerAccount.toString(),
						},
					],
				},
			};

			yield* asyncResultToEffect(
				sedaChain.queueCosmosMessage(
					sendMsg,
					TransactionPriority.LOW,
					{ gas: "auto", adjustmentFactor: config.sedaChain.gasAdjustmentFactorCosmosMessages },
					0,
				),
			);

			logger.info(
				`${accountIndex}: Sent ${formatTokenUnits(config.sedaChain.minSedaPerAccount)} SEDA to ${sedaChain.getSignerAddress(accountIndex)}`,
			);
		}

		return yield* Effect.succeed(void 0);
	}).pipe(Effect.withSpan("sendSedaToSubAccounts"));
