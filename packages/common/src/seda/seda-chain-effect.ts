import type { IndexedTx } from "@cosmjs/cosmwasm-stargate";

import type { Coin, EncodeObject } from "@cosmjs/proto-signing";
import type { Block } from "@cosmjs/stargate";
import type { ExecuteMsg, QueryMsg } from "@sedaprotocol/core-contract-schema";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Context, Deferred, Duration, Effect, Either, Layer, Match, Option, Ref } from "effect";
import { asyncResultToEffect, asyncToEffect, effectToAsyncResult } from "../services/effect-utils";
import { type PriorityQueue, PriorityQueueUnbounded } from "../services/priority-queue";
import { IncorrectAccountSquence } from "./errors";
import type { GasOptions } from "./gas-options";
import { type OracleProgram, createWasmQueryClient } from "./query-client";
import { type TransactionPriority, narrowDownError } from "./seda-chain";
import { getTransaction, signAndSendTxSync } from "./sign-and-send-tx";
import { Signer } from "./signer";
import { type SedaSigningCosmWasmClient, SigningClientService } from "./signing-client";

export interface SedaChainTx {
	id: string;
	messages: EncodeObject[];
	gasOptions: Option.Option<GasOptions>;
	priority: TransactionPriority;
	signerInfo: SignerInfo;
	callback: Deferred.Deferred<string, Error>;
}

export interface SmartContractMessage {
	message: ExecuteMsg;
	attachedAttoSeda: Option.Option<bigint>;
}

export interface SignerInfo {
	accountIndex: number;
	address: string;
	nonceId: number;
}

export interface TransactionStats {
	successCount: number;
	failureCount: number;
	pendingCount: number;
	retryCount: number;
}

export class SedaChainService extends Context.Tag("SedaChainService")<
	SedaChainService,
	{
		readonly getSignerInfo: (accountIndex: Option.Option<number>) => SignerInfo;
		readonly getAllSigners: () => Effect.Effect<SignerInfo[]>;
		readonly getTransactionStats: () => Effect.Effect<TransactionStats>;

		readonly queueMessage: (
			id: string,
			messages: EncodeObject[],
			priority: TransactionPriority,
			signerInfo: SignerInfo,
			gasOptions: Option.Option<GasOptions>,
		) => Effect.Effect<IndexedTx, Error>;

		readonly queueSmartContractMessage: (
			id: string,
			messages: SmartContractMessage[],
			priority: TransactionPriority,
			signerInfo: SignerInfo,
			gasOptions: Option.Option<GasOptions>,
		) => Effect.Effect<IndexedTx, Error>;

		readonly start: () => Effect.Effect<void, Error>;
		readonly queryContractSmart: <T = unknown>(
			queryMsg: QueryMsg,
			withBigInt?: boolean,
			accountIndex?: number,
		) => Effect.Effect<T, Error>;

		readonly getOracleProgram: (execProgramId: string) => Effect.Effect<Option.Option<OracleProgram>, Error>;
		readonly getCoreContractAddress: () => Effect.Effect<string, Error>;
		readonly getBlock: (height: Option.Option<number>) => Effect.Effect<Block, Error>;
		readonly getBalance: (address: string, denom: Option.Option<string>) => Effect.Effect<Coin, Error>;
	}
>() {}

export const SedaChainServiceLayer = (config: AppConfig) =>
	Effect.gen(function* () {
		const signingClientService = yield* SigningClientService;

		const transactionStats = yield* Ref.make<TransactionStats>({
			successCount: 0,
			failureCount: 0,
			pendingCount: 0,
			retryCount: 0,
		});

		// First we create all the signers and their clients
		const signerClients: SedaSigningCosmWasmClient[] = [];
		const signers: Signer[] = [];
		const queues: PriorityQueue<SedaChainTx>[] = [];

		for (const [accountIndex] of Array(config.sedaChain.accountAmounts).entries()) {
			const signer = yield* asyncResultToEffect(Signer.fromConfig(config, accountIndex));
			const signingClient = yield* signingClientService.createClient(signer, true, {
				followRedirects: config.sedaChain.followHttpRedirects,
				redirectTtlMs: config.sedaChain.httpRedirectTtlMs,
			});

			signerClients.push(signingClient.client);
			signers.push(signer);
			queues.push(yield* PriorityQueueUnbounded<SedaChainTx>());
		}

		const wasmStorageQueryClient = yield* asyncToEffect(createWasmQueryClient(config.sedaChain.rpc));

		// Each transaction gets a nonce, wich we use to round robin through the signers
		let nonceId = 0;

		return Layer.effect(
			SedaChainService,
			Effect.gen(function* () {
				const queueMessage = (
					id: string,
					messages: EncodeObject[],
					priority: TransactionPriority,
					signerInfo: SignerInfo,
					gasOptions: Option.Option<GasOptions>,
				) =>
					Effect.gen(function* () {
						const callback = yield* Deferred.make<string, Error>();
						yield* queues[signerInfo.accountIndex].offer(
							{
								id,
								messages,
								priority,
								signerInfo,
								gasOptions,
								callback,
							},
							priority,
						);

						yield* Ref.update(transactionStats, (stats) => ({
							...stats,
							pendingCount: stats.pendingCount + 1,
						}));

						logger.trace("Waiting for transaction", { id });
						const transactionHash = yield* Deferred.await(callback);
						logger.trace(`Transaction received: ${transactionHash}`, { id });

						const transactionResult = yield* pollTransaction(id, transactionHash);
						logger.trace("Transaction processed", { id });
						return transactionResult;
					}).pipe(Effect.withSpan("queueMessage"),);

				const queueSmartContractMessage = (
					id: string,
					messages: SmartContractMessage[],
					priority: TransactionPriority,
					signerInfo: SignerInfo,
					gasOptions: Option.Option<GasOptions>,
				) =>
					Effect.gen(function* () {
						const encodedMessages: EncodeObject[] = [];

						for (const smartContractMessage of messages) {
							encodedMessages.push({
								typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
								value: {
									sender: signerInfo.address,
									contract: yield* getCoreContractAddress(),
									msg: Buffer.from(JSON.stringify(smartContractMessage.message)),
									funds: smartContractMessage.attachedAttoSeda.pipe(
										Option.map((amount) => [{ denom: "aseda", amount }]),
										Option.getOrElse(() => []),
									),
								},
							});
						}

						return yield* queueMessage(id, encodedMessages, priority, signerInfo, gasOptions);
					}).pipe(Effect.withSpan("queueSmartContractMessage"));

				const getSignerInfo = (forcedAccountIndex: Option.Option<number>) => {
					const accountIndex = forcedAccountIndex.pipe(
						Option.getOrElse(() => {
							nonceId++;
							return nonceId % signers.length;
						}),
					);

					const signer = signers[accountIndex];
					return { accountIndex, address: signer.getAddress(), nonceId };
				};

				const processQueue = (accountIndex: number) =>
					Effect.gen(function* () {
						// TODO: This is here because the SEDA chain cannot handle that many RPC requests at once
						// We should remove this once the SEDA chain RPC is faster
						yield* Effect.sleep(Duration.millis(200));
						const transaction = yield* queues[accountIndex].take();

						const result = yield* asyncToEffect(
							signAndSendTxSync(
								config.sedaChain,
								signerClients[accountIndex],
								transaction.signerInfo.address,
								transaction.messages,
								transaction.gasOptions.pipe(Option.getOrUndefined),
								config.sedaChain.memo,
								transaction.id,
							),
						);

						if (result.isErr) {
							if (result.error instanceof IncorrectAccountSquence) {
								logger.warn(`Incorrect account sequence, adding tx back to the queue: ${result.error}`, {
									id: transaction.id,
								});

								yield* queues[accountIndex].offer(transaction, transaction.priority);
								return;
							}

							logger.warn(`Transaction failed: ${result.error}`, {
								id: transaction.id,
							});

							// Always resolve the Deferred, even on error
							return yield* Deferred.fail(transaction.callback, result.error);
						}

						logger.trace("Transaction processed", {
							id: transaction.id,
						});

						return yield* Deferred.succeed(transaction.callback, result.value);
					}).pipe(Effect.withSpan("processQueue"), Effect.forever);

				const pollTransaction = (id: string, transactionHash: string) =>
					Effect.gen(function* () {
						const transactionResult = yield* asyncToEffect(getTransaction(signerClients[0], transactionHash));

						logger.trace("Polling transaction", { id: transactionHash });

						if (transactionResult.isErr) {
							logger.error(`Transaction could not be received for ${transactionHash}: ${transactionResult.error}`, {
								id,
							});

							return yield* Effect.fail(narrowDownError(transactionResult.error));
						}

						if (transactionResult.value.isNothing) {
							yield* Effect.sleep(Duration.millis(config.sedaChain.transactionPollInterval));
						}

						return yield* Effect.succeed(transactionResult.value);
					})
						.pipe(
							Effect.repeat({ until: (result) => result.isJust }),
							Effect.map((result) => result.value),
							Effect.withSpan("pollTransaction"),
						);

				const start = () =>
					Effect.gen(function* () {
						for (const [accountIndex] of queues.entries()) {
							yield* Effect.forkDaemon(processQueue(accountIndex));
						}
					}).pipe(Effect.withSpan("start"));

				const queryContractSmart = <T>(queryMsg: QueryMsg, withBigInt = false, accountIndex = 0) =>
					Effect.gen(function* () {
						const coreContractAddress = yield* asyncToEffect(signers[accountIndex].getCoreContractAddress());
						const match = yield* Match.value(withBigInt).pipe(
							Match.when(true, () =>
								asyncToEffect(signerClients[accountIndex].queryContractSmartBigInt(coreContractAddress, queryMsg)),
							),
							Match.when(false, () =>
								asyncToEffect(signerClients[accountIndex].queryContractSmart(coreContractAddress, queryMsg)),
							),
							Match.exhaustive,
						);

						return match as T;
					}).pipe(Effect.withSpan("queryContractSmart"));

				const getOracleProgram = (execProgramId: string) =>
					Effect.gen(function* () {
						const result = yield* Effect.either(
							asyncToEffect(wasmStorageQueryClient.OracleProgram({ hash: execProgramId })),
						);

						if (Either.isLeft(result)) {
							if (result.left.message.includes("not found")) {
								return Option.none();
							}

							return yield* Effect.fail(result.left);
						}

						return Option.fromNullable(result.right.oracleProgram);
					}).pipe(Effect.withSpan("getOracleProgram"));

				const getCoreContractAddress = () =>
					Effect.gen(function* () {
						const coreContractAddress = yield* asyncToEffect(signers[0].getCoreContractAddress());
						return coreContractAddress;
					}).pipe(Effect.withSpan("getCoreContractAddress"));

				const getBlock = (height: Option.Option<number>) =>
					Effect.gen(function* () {
						return yield* asyncToEffect(signerClients[0].getBlock(Option.getOrUndefined(height)));
					});

				const getBalance = (address: string, denom: Option.Option<string>) =>
					Effect.gen(function* () {
						return yield* asyncToEffect(
							signerClients[0].getBalance(address, denom.pipe(Option.getOrElse(() => "aseda"))),
						);
					});

				const getAllSigners = () => {
					const result: SignerInfo[] = signers.map((value, index) => {
						return {
							accountIndex: index,
							address: value.getAddress(),
							nonceId: 0,
						};
					});

					return Effect.succeed(result);
				};

				// TODO: Fill these in
				const getTransactionStats = () => Effect.gen(function* () {
					return yield* Ref.get(transactionStats);
				});

				return {
					getBlock,
					queueMessage,
					queueSmartContractMessage,
					getSignerInfo,
					getAllSigners,
					start,
					queryContractSmart,
					getOracleProgram,
					getCoreContractAddress,
					getBalance,
					getTransactionStats,
				};
			}),
		);
	});

export async function sendTx(
	layer: Layer.Layer<SedaChainService>,
	id: string,
	messages: EncodeObject[],
	priority: TransactionPriority,
	forceAccountIndex: Option.Option<number>,
	gasOptions: Option.Option<GasOptions>,
) {
	const program = Effect.gen(function* () {
		const sedaChainService = yield* SedaChainService;
		const signerInfo = sedaChainService.getSignerInfo(forceAccountIndex);
		const result = yield* sedaChainService.queueMessage(id, messages, priority, signerInfo, gasOptions);

		return result;
	}).pipe(
		Effect.provide(layer),
		Effect.catchAll((error) => {
			return Effect.fail(error);
		}),
	);

	return await effectToAsyncResult(program);
}

export async function sendSmartContractTx(
	layer: Layer.Layer<SedaChainService>,
	id: string,
	messages: SmartContractMessage[],
	priority: TransactionPriority,
	forceAccountIndex: Option.Option<number>,
	gasOptions: Option.Option<GasOptions>,
) {
	const program = Effect.gen(function* () {
		const sedaChainService = yield* SedaChainService;
		const signerInfo = sedaChainService.getSignerInfo(forceAccountIndex);
		const result = yield* sedaChainService.queueSmartContractMessage(id, messages, priority, signerInfo, gasOptions);

		return result;
	}).pipe(
		Effect.provide(layer),
		Effect.catchAll((error) => {
			return Effect.fail(error);
		}),
	);

	return await effectToAsyncResult(program);
}

export const startSedaChainService = async (layer: Layer.Layer<SedaChainService>) => {
	const program = Effect.gen(function* () {
		const sedaChainService = yield* SedaChainService;
		yield* sedaChainService.start();
	}).pipe(Effect.provide(layer));

	await Effect.runPromise(program);
};

export const queryContractSmart = async <T>(
	layer: Layer.Layer<SedaChainService>,
	queryMsg: QueryMsg,
	withBigInt = false,
	accountIndex = 0,
) => {
	const program = Effect.gen(function* () {
		const sedaChainService = yield* SedaChainService;
		return yield* sedaChainService.queryContractSmart<T>(queryMsg, withBigInt, accountIndex);
	}).pipe(Effect.withSpan("queryContractSmart"), Effect.provide(layer));

	return await effectToAsyncResult(program);
};

export const getCoreContractAddress = async (layer: Layer.Layer<SedaChainService>) => {
	const program = Effect.gen(function* () {
		const sedaChainService = yield* SedaChainService;
		return yield* sedaChainService.getCoreContractAddress();
	}).pipe(Effect.provide(layer));

	return await Effect.runPromise(program);
};

export const getBlock = async (layer: Layer.Layer<SedaChainService>, height: Option.Option<number>) => {
	const program = Effect.gen(function* () {
		const sedaChainService = yield* SedaChainService;
		return yield* sedaChainService.getBlock(height);
	}).pipe(Effect.provide(layer));

	return await effectToAsyncResult(program);
};
