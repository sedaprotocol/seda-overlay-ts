import { SedaChainService, TransactionPriority } from "@sedaprotocol/overlay-ts-common";
import { formatTokenUnits } from "@sedaprotocol/overlay-ts-common";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Effect, Option } from "effect";

/**
 * Making sure all accounts have at least the minimum SEDA amount
 * This is to be able to execute transactions on the chain. Not alot is needed since the chain refunds succesfully executed transactions.
 */
export const sendSedaToSubAccounts = (config: AppConfig) =>
	Effect.gen(function* () {
		const sedaChain = yield* SedaChainService;

		// We only want to send tokens from the first account
		const sender = sedaChain.getSignerInfo(Option.some(0));

		// First we need to make sure the first account has enough tokens
		const balance = yield* sedaChain.getBalance(sender.address, Option.none());

		logger.debug(`${sender.address} has ${formatTokenUnits(balance.amount)} SEDA`);

		// We want to maintain atleast twice the minimum SEDA per account
		// This is to fully drain the first account
		if (BigInt(balance.amount) < config.sedaChain.minSedaPerAccount * 2n) {
			logger.error(
				`Not enough SEDA to send to sub accounts, SEDA address: ${sender.address} has less than ${formatTokenUnits(config.sedaChain.minSedaPerAccount * 2n)} SEDA`,
			);

			return yield* Effect.fail(new Error("Not enough SEDA to send to sub accounts"));
		}

		const allSigners = yield* sedaChain.getAllSigners();

		for (const signer of allSigners) {
			// We don't want to send tokens to the first account (itself)
			if (signer.accountIndex === 0) continue;

			const balance = yield* sedaChain.getBalance(signer.address, Option.none());

			if (BigInt(balance.amount) >= config.sedaChain.minSedaPerAccount) {
				logger.debug(
					`${signer.accountIndex}: Account ${signer.address} has enough SEDA (min: ${formatTokenUnits(config.sedaChain.minSedaPerAccount)} SEDA, current: ${formatTokenUnits(balance.amount)} SEDA)`,
				);
				continue;
			}

			logger.info(
				`${signer.accountIndex}: Account ${signer.address} has less than the minimum SEDA amount. Sending ${formatTokenUnits(config.sedaChain.minSedaPerAccount)} SEDA..`,
			);

			const sendMsg = [
				{
					typeUrl: "/cosmos.bank.v1beta1.MsgSend",
					value: {
						fromAddress: sender.address,
						toAddress: signer.address,
						amount: [
							{
								denom: "aseda",
								amount: config.sedaChain.minSedaPerAccount.toString(),
							},
						],
					},
				},
			];

			yield* Effect.forkDaemon(
				sedaChain.queueMessage(
					`${sender.address}_topup`,
					sendMsg,
					TransactionPriority.LOW,
					sender,
					Option.some({ gas: "auto", adjustmentFactor: config.sedaChain.gasAdjustmentFactorCosmosMessages }),
				),
			);

			logger.info(
				`${sender.accountIndex}: Sent ${formatTokenUnits(config.sedaChain.minSedaPerAccount)} SEDA to ${sender.address}`,
			);
		}

		return yield* Effect.succeed(void 0);
	}).pipe(Effect.withSpan("sendSedaToSubAccounts"));
