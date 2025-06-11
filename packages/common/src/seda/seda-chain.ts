import type { IndexedTx } from "@cosmjs/cosmwasm-stargate";
import type { EncodeObject } from "@cosmjs/proto-signing";
import type { ProtobufRpcClient } from "@cosmjs/stargate";
import type { sedachain } from "@seda-protocol/proto-messages";
import { tryAsync } from "@seda-protocol/utils";
import type { ExecuteMsg, QueryMsg } from "@sedaprotocol/core-contract-schema";
import { debouncedInterval } from "@sedaprotocol/overlay-ts-common";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { EventEmitter } from "eventemitter3";
import { Maybe, Result } from "true-myth";
import {
	AlreadyCommitted,
	AlreadyRevealed,
	DataRequestExpired,
	DataRequestNotFound,
	IncorrectAccountSquence,
	RevealMismatch,
	RevealStarted,
} from "./errors";
import type { GasOptions } from "./gas-options";
import { createProtoQueryClient, createWasmQueryClient } from "./query-client";
import { getTransaction, signAndSendTxSync } from "./sign-and-send-tx";
import { type ISigner, Signer } from "./signer";
import { type SedaSigningCosmWasmClient, createSigningClient } from "./signing-client";

type EventMap = {
	"tx-error": [string, TransactionMessage | undefined];
	"tx-success": [TransactionMessage, IndexedTx];
};

export interface TransactionMessage {
	id: string;
	message: EncodeObject;
	type: string;
	gasOptions?: GasOptions;
	processingMode: TransactionProcessingMode;
}

type CallBackInfo = {
	txHash: Result<string, Error>;
	batchMessageIndex: number;
};

export enum TransactionProcessingMode {
	Batch = 0,
	Single = 1,
}

export class SedaChain extends EventEmitter<EventMap> {
	public transactionQueue: TransactionMessage[] = [];
	private queueCallbacks: Map<string, (value: CallBackInfo) => void> = new Map();
	private intervalId?: Timer;
	private nonceId = 0;

	// Metrics:
	private txSuccessCount = 0;
	private txFailureCount = 0;
	private txRetryCount = 0;

	private constructor(
		public signer: ISigner,
		private signerClient: SedaSigningCosmWasmClient,
		private protoClient: ProtobufRpcClient,
		private wasmStorageQueryClient: sedachain.wasm_storage.v1.QueryClientImpl,
		private config: AppConfig,
	) {
		super();
	}

	getProtobufRpcClient(): ProtobufRpcClient {
		return this.protoClient;
	}

	getWasmStorageQueryClient() {
		return this.wasmStorageQueryClient;
	}

	getSignerAddress() {
		return this.signer.getAddress();
	}

	/**
	 * TODO: Refresh the core contract address after a while (through a caching layer)
	 *
	 * Gets the address of the core SEDA protocol smart contract that this chain instance is configured to interact with
	 * @returns The address of the core SEDA protocol smart contract
	 */
	getCoreContractAddress() {
		return this.signer.getCoreContractAddress();
	}

	queueMessages(messages: TransactionMessage[]) {
		for (const message of messages) {
			this.transactionQueue.push(message);
		}
	}

	async getTransaction(txHash: string) {
		return getTransaction(this.signerClient, txHash);
	}

	getTransactionStats() {
		return {
			successCount: this.txSuccessCount,
			failureCount: this.txFailureCount,
			pendingCount: this.transactionQueue.length,
			retryCount: this.txRetryCount,
		};
	}

	async queueSmartContractMessage(
		executeMsg: ExecuteMsg,
		processingMode: TransactionProcessingMode,
		attachedAttoSeda?: bigint,
		gasOptions?: GasOptions,
	): Promise<CallBackInfo> {
		return new Promise(async (resolve) => {
			this.nonceId += 1;

			const message = {
				typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
				value: {
					sender: this.getSignerAddress(),
					contract: await this.getCoreContractAddress(),
					funds: attachedAttoSeda ? [{ denom: "aseda", amount: attachedAttoSeda.toString() }] : [],
					msg: Buffer.from(JSON.stringify(executeMsg)),
				},
			};

			this.queueMessages([
				{
					id: this.nonceId.toString(),
					message,
					gasOptions,
					processingMode,
					type: "contract",
				},
			]);

			this.queueCallbacks.set(this.nonceId.toString(), resolve);
		});
	}

	async queryContractSmart<T = unknown>(queryMsg: QueryMsg): Promise<Result<T, Error>> {
		const coreContractAddress = await this.getCoreContractAddress();

		return tryAsync<T>(() => this.signerClient.queryContractSmart(coreContractAddress, queryMsg));
	}

	/**
	 * Signs and sends a transaction synchronously with the given execute message and options.
	 *
	 * @param executeMsg - The execute message to send to the smart contract
	 * @param attachedAttoSeda - Optional amount of SEDA tokens (in atto) to attach to the transaction
	 * @param gasOptions - Optional gas configuration for the transaction
	 *
	 * @returns A Result containing either the transaction hash on success or an Error on failure
	 */
	async signAndSendTxSync(
		executeMsg: ExecuteMsg,
		attachedAttoSeda?: bigint,
		gasOptions?: GasOptions,
	): Promise<Result<string, Error>> {
		const message = {
			typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
			value: {
				sender: this.getSignerAddress(),
				contract: await this.getCoreContractAddress(),
				funds: attachedAttoSeda ? [{ denom: "aseda", amount: attachedAttoSeda.toString() }] : [],
				msg: Buffer.from(JSON.stringify(executeMsg)),
			},
		};

		const result = await signAndSendTxSync(
			this.config.sedaChain,
			this.signerClient,
			this.signer.getAddress(),
			[message],
			gasOptions,
			this.config.sedaChain.memo,
		);
		return result;
	}

	private getNextBatchOfMessages(): TransactionMessage[] {
		const result: TransactionMessage[] = [];
		const indexesToRemove: number[] = [];

		// Get all the batch messages
		for (const [index, msg] of this.transactionQueue.entries()) {
			if (result.length >= this.config.sedaChain.batchedTxAmount) break;

			if (msg.processingMode === TransactionProcessingMode.Batch) {
				result.push(msg);
				indexesToRemove.push(index);
			}
		}

		// Remove the messages that we are going to process
		for (const index of indexesToRemove) {
			this.transactionQueue.splice(index, 1);
		}

		// When there are no batch messages, get one single message
		if (result.length === 0) {
			return this.transactionQueue.splice(0, 1);
		}

		return result;
	}

	/**
	 * Processes a single transaction from the queue to maintain proper sequence numbers.
	 * In Cosmos blockchains, transactions must be processed sequentially with incrementing
	 * sequence numbers. This method ensures transactions are handled one at a time in order.
	 * @returns void
	 */
	async processQueue() {
		const txMessages = this.getNextBatchOfMessages();
		if (txMessages.length === 0) return;

		const cosmosMessage = txMessages.map(msg => msg.message);
		const gasOption = txMessages[0].gasOptions ?? { gas: this.config.sedaChain.gas };
		const result = await signAndSendTxSync(
			this.config.sedaChain,
			this.signerClient,
			this.signer.getAddress(),
			cosmosMessage,
			gasOption,
			this.config.sedaChain.memo,
		);

		if (result.isErr) {
			if (result.error instanceof IncorrectAccountSquence) {
				logger.warn(`Incorrect account sequence, adding tx back to the queue: ${result.error}`);
				this.txRetryCount++;
				this.transactionQueue.push(...txMessages);
				return;
			}

			this.txFailureCount++;
			logger.error(`Transaction failed: ${result.error}`);

			// TODO: Remove the failing transaction from the queue and process the rest.
			const messageIndex = getBatchMessageIndexFromError(result.error);

			if (messageIndex.isJust) {
				const erroredTx = txMessages.splice(messageIndex.value, 1);

				// Only call the callback for the errored transaction if it exists
				const callback = Maybe.of(this.queueCallbacks.get(erroredTx[0].id));
				if (callback.isJust) {
					callback.value({
						txHash: Result.err(result.error),
						batchMessageIndex: messageIndex.value,
					});
					this.queueCallbacks.delete(erroredTx[0].id);
				}

				// Re-queue the rest of the transactions
				this.transactionQueue.push(...txMessages);
			}
		} else {
			this.txSuccessCount++;
		}

		for (const [index, txMessage] of txMessages.entries()) {
			const callback = Maybe.of(this.queueCallbacks.get(txMessage.id));

			if (callback.isNothing) {
				logger.error(`Could not find callback for message id: ${txMessage.id}: ${txMessage}`);
				return;
			}

			callback.value({
				txHash: result,
				batchMessageIndex: index,
			});
			this.queueCallbacks.delete(txMessage.id);
		}
	}

	stop() {
		clearInterval(this.intervalId);
	}

	start() {
		this.stop();

		this.intervalId = debouncedInterval(async () => {
			await this.processQueue();
		}, this.config.sedaChain.queueInterval);
	}

	static async fromConfig(config: AppConfig, cacheSequenceNumber = true): Promise<Result<SedaChain, unknown>> {
		const signer = await Signer.fromConfig(config);
		const protoClient = await createProtoQueryClient(config.sedaChain.rpc);
		const signingClient = await createSigningClient(signer, cacheSequenceNumber);
		const wasmStorageClient = await createWasmQueryClient(config.sedaChain.rpc);

		if (signingClient.isErr) {
			return Result.err(signingClient.error);
		}

		return Result.ok(new SedaChain(signer, signingClient.value.client, protoClient, wasmStorageClient, config));
	}

	async waitForSmartContractTransaction(
		executeMsg: ExecuteMsg,
		processingMode: TransactionProcessingMode,
		attachedAttoSeda?: bigint,
		gasOptions?: GasOptions,
	): Promise<
		Result<IndexedTx, DataRequestExpired | AlreadyCommitted | AlreadyRevealed | RevealMismatch | RevealStarted | Error>
	> {
		return new Promise(async (resolve) => {
			const transactionHash = await this.queueSmartContractMessage(executeMsg, processingMode, attachedAttoSeda, gasOptions);

			if (transactionHash.txHash.isErr) {
				const messageIndex = getBatchMessageIndexFromError(transactionHash.txHash.error);

				// If the error was caused by this transaction, return the error,
				// otherwise we should retry the transaction.
				if (messageIndex.isJust && transactionHash.batchMessageIndex === messageIndex.value) {
					const error = narrowDownError(transactionHash.txHash.error);
					resolve(Result.err(error));
					return;
				}

				resolve(await this.waitForSmartContractTransaction(executeMsg, processingMode, attachedAttoSeda, gasOptions));
				return;
			}

			const checkTransactionInterval = debouncedInterval(async () => {
				const transactionResult = await this.getTransaction(transactionHash.txHash.unwrapOr(""));

				if (transactionResult.isErr) {
					logger.error(`Transaction could not be received: ${transactionResult.error}`, {
						id: transactionHash.txHash.unwrapOr(""),
					});

					const error = narrowDownError(transactionResult.error);
					const messageIndex = getBatchMessageIndexFromError(error);
					clearInterval(checkTransactionInterval);

					// If the error was caused by this transaction, return the error,
					// otherwise we should retry the transaction.
					if (messageIndex.isJust && transactionHash.batchMessageIndex === messageIndex.value) {
						resolve(Result.err(error));
						return;
					}

					resolve(await this.waitForSmartContractTransaction(executeMsg, processingMode, attachedAttoSeda, gasOptions));
					return;
				}

				if (transactionResult.value.isNothing) {
					logger.debug("No tx result found yet", {
						id: transactionHash.txHash.unwrapOr(""),
					});
					return;
				}

				logger.debug("Tx result found", {
					id: transactionHash.txHash.unwrapOr(""),
				});

				clearInterval(checkTransactionInterval);
				resolve(Result.ok(transactionResult.value.value));
			}, this.config.sedaChain.transactionPollInterval);
		});
	}
}

function narrowDownError(
	error: Error,
):
	| AlreadyCommitted
	| RevealMismatch
	| AlreadyRevealed
	| DataRequestExpired
	| DataRequestNotFound
	| RevealStarted
	| Error {
	if (AlreadyCommitted.isError(error)) {
		return new AlreadyCommitted(error.message);
	}

	if (RevealMismatch.isError(error)) {
		return new RevealMismatch(error.message);
	}

	if (AlreadyRevealed.isError(error)) {
		return new AlreadyRevealed(error.message);
	}

	if (DataRequestExpired.isError(error)) {
		return new DataRequestExpired(error.message);
	}

	if (DataRequestNotFound.isError(error)) {
		return new DataRequestNotFound(error.message);
	}

	if (RevealStarted.isError(error)) {
		return new RevealStarted(error.message);
	}

	return error;
}

function getBatchMessageIndexFromError(error: Error): Maybe<number> {
	const messageIndexRegex = new RegExp(/message index: (\d+)/gm);
	const capturedGroup = Maybe.of(messageIndexRegex.exec(error.message));

	if (capturedGroup.isJust) {
		return Maybe.of(Number(capturedGroup.value[1]));
	}

	return Maybe.nothing();
}