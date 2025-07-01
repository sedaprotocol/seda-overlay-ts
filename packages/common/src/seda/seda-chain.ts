import type { IndexedTx } from "@cosmjs/cosmwasm-stargate";
import type { EncodeObject } from "@cosmjs/proto-signing";
import type { Block, ProtobufRpcClient } from "@cosmjs/stargate";
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

// Transactions with a high priority will be put in the front of the queue
export enum TransactionPriority {
	LOW = "low",
	HIGH = "high",
}

export interface TransactionMessage {
	id: string;
	message: EncodeObject;
	type: string;
	gasOptions?: GasOptions;
	accountIndex: number;
	priority: TransactionPriority;
	traceId?: string;
}

export class SedaChain extends EventEmitter<EventMap> {
	private queueCallbacks: Map<string, (value: Result<string, Error>) => void> = new Map();
	private intervalIds: Timer[] = [];
	private nonceId = 0;

	// Per-account sequence coordination
	private accountSequenceQueues: Map<number, TransactionMessage[]> = new Map();
	private accountProcessingLocks: Map<number, boolean> = new Map();

	// Metrics:
	private txSuccessCount = 0;
	private txFailureCount = 0;
	private txRetryCount = 0;

	private constructor(
		public signers: ISigner[],
		public signerClients: SedaSigningCosmWasmClient[],
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

	getSignerAddress(accountIndex = 0) {
		return this.signers[accountIndex].getAddress();
	}

	/**
	 * TODO: Refresh the core contract address after a while (through a caching layer)
	 *
	 * Gets the address of the core SEDA protocol smart contract that this chain instance is configured to interact with
	 * @returns The address of the core SEDA protocol smart contract
	 */
	getCoreContractAddress(accountIndex = 0) {
		return this.signers[accountIndex].getCoreContractAddress();
	}

	queueMessages(messages: TransactionMessage[]) {
		// Group messages by account for proper sequence coordination
		const messagesByAccount = new Map<number, TransactionMessage[]>();
		
		for (const message of messages) {
			const accountIndex = message.accountIndex;
			if (!messagesByAccount.has(accountIndex)) {
				messagesByAccount.set(accountIndex, []);
			}
			messagesByAccount.get(accountIndex)!.push(message);
		}
		
		// Add messages to per-account queues
		for (const [accountIndex, accountMessages] of messagesByAccount) {
			if (!this.accountSequenceQueues.has(accountIndex)) {
				this.accountSequenceQueues.set(accountIndex, []);
			}
			
			const accountQueue = this.accountSequenceQueues.get(accountIndex)!;
			
			// Sort by priority (high priority first)
			accountMessages.sort((a, b) => {
				if (a.priority === TransactionPriority.HIGH && b.priority === TransactionPriority.LOW) return -1;
				if (a.priority === TransactionPriority.LOW && b.priority === TransactionPriority.HIGH) return 1;
				return 0;
			});
			
			accountQueue.push(...accountMessages);
		}
		
		// Trigger immediate processing for affected accounts
		setImmediate(() => {
			Promise.all(
				Array.from(messagesByAccount.keys()).map(accountIndex => 
					this.processAccountQueue(accountIndex)
				)
			).catch((error) => {
				logger.error(`Error in immediate queue processing: ${error}`);
			});
		});
	}

	async getTransaction(txHash: string, accountIndex = 0) {
		return getTransaction(this.signerClients[accountIndex], txHash);
	}

	async getBlock(height?: number, accountIndex = 0): Promise<Result<Block, Error>> {
		return tryAsync<Block>(() => this.signerClients[accountIndex].getBlock(height));
	}

	getTransactionStats() {
		const pendingCount = Array.from(this.accountSequenceQueues.values())
			.reduce((total, queue) => total + queue.length, 0);
		
		return {
			successCount: this.txSuccessCount,
			failureCount: this.txFailureCount,
			pendingCount,
			retryCount: this.txRetryCount,
		};
	}

	async queueCosmosMessage(
		message: EncodeObject,
		priority: TransactionPriority,
		gasOptions?: GasOptions,
		accountIndex = 0,
	): Promise<Result<string, Error>> {
		return new Promise(async (resolve) => {
			this.nonceId += 1;

			this.queueMessages([
				{
					id: this.nonceId.toString(),
					message,
					gasOptions,
					type: "cosmos",
					priority,
					accountIndex,
				},
			]);

			this.queueCallbacks.set(this.nonceId.toString(), resolve);
		});
	}

	async queueSmartContractMessage(
		executeMsg: ExecuteMsg,
		priority: TransactionPriority,
		attachedAttoSeda?: bigint,
		gasOptions?: GasOptions,
		forcedAccountIndex?: number,
		traceId?: string,
	): Promise<Result<string, Error>> {
		return new Promise(async (resolve) => {
			this.nonceId += 1;

			// Always use account 0 for simplicity and to eliminate sequence conflicts
			let accountIndex = 0;

			// Some cases like staking, unstaking require a specific account index
			// this is because most of the time index 0 has all the funds
			if (forcedAccountIndex !== undefined) {
				accountIndex = forcedAccountIndex;
			}

			logger.trace(`Using account index ${accountIndex} for transaction (forced: ${forcedAccountIndex})`, {
				id: traceId,
			});

			const message = {
				typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
				value: {
					sender: this.getSignerAddress(accountIndex),
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
					type: "contract",
					accountIndex,
					priority,
					traceId,
				},
			]);

			this.queueCallbacks.set(this.nonceId.toString(), resolve);
		});
	}

	/**
	 * Queries a smart contract with a query message and returns the result as a JSON object.
	 * It uses the big int encoding for numbers that are too big for the JSON standard.
	 *
	 * @param queryMsg - The query message to send to the smart contract
	 * @param accountIndex - The index of the account to use for the query
	 *
	 * @returns A Result containing either the result on success or an Error on failure
	 */
	async queryContractSmartBigInt<T = unknown>(queryMsg: QueryMsg, accountIndex = 0): Promise<Result<T, Error>> {
		const coreContractAddress = await this.getCoreContractAddress(accountIndex);
		return tryAsync<T>(() => this.signerClients[accountIndex].queryContractSmartBigInt(coreContractAddress, queryMsg));
	}

	async queryContractSmart<T = unknown>(queryMsg: QueryMsg, accountIndex = 0): Promise<Result<T, Error>> {
		const coreContractAddress = await this.getCoreContractAddress(accountIndex);

		return tryAsync<T>(() => this.signerClients[accountIndex].queryContractSmart(coreContractAddress, queryMsg));
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
		accountIndex = 0,
	): Promise<Result<string, Error>> {
		const message = {
			typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
			value: {
				sender: this.getSignerAddress(accountIndex),
				contract: await this.getCoreContractAddress(),
				funds: attachedAttoSeda ? [{ denom: "aseda", amount: attachedAttoSeda.toString() }] : [],
				msg: Buffer.from(JSON.stringify(executeMsg)),
			},
		};

		const result = await signAndSendTxSync(
			this.config.sedaChain,
			this.signerClients[accountIndex],
			this.getSignerAddress(accountIndex),
			[message],
			gasOptions,
			this.config.sedaChain.memo,
		);
		return result;
	}

	/**
	 * Processes transactions sequentially for a specific account to maintain proper sequence numbers.
	 * Each account processes its transactions one by one to avoid sequence conflicts.
	 */
	private async processAccountQueue(accountIndex: number): Promise<void> {
		// Check if this account is already being processed
		if (this.accountProcessingLocks.get(accountIndex)) {
			return;
		}

		// Lock this account's processing
		this.accountProcessingLocks.set(accountIndex, true);

		try {
			const accountQueue = this.accountSequenceQueues.get(accountIndex);
			if (!accountQueue || accountQueue.length === 0) {
				return;
			}

			// Process one transaction at a time for this account
			const transaction = accountQueue.shift()!;
			const cosmosMessage = transaction.message;
			const gasOption = transaction.gasOptions ?? { gas: this.config.sedaChain.gas };

			const result = await signAndSendTxSync(
				this.config.sedaChain,
				this.signerClients[transaction.accountIndex],
				this.getSignerAddress(transaction.accountIndex),
				[cosmosMessage],
				gasOption,
				this.config.sedaChain.memo,
				transaction.traceId,
			);

			if (result.isErr) {
				if (result.error instanceof IncorrectAccountSquence) {
					logger.warn(`Incorrect account sequence, adding tx back to front of queue: ${result.error}`, {
						id: transaction.traceId,
					});

					this.txRetryCount++;

					// Put the transaction back at the front of the queue for retry
					accountQueue.unshift(transaction);
				} else {
					this.txFailureCount++;
					logger.error(`Transaction failed: ${result.error}`, {
						id: transaction.traceId,
					});

					// Notify the callback of the failure
					const callback = this.queueCallbacks.get(transaction.id);
					if (callback) {
						callback(result);
						this.queueCallbacks.delete(transaction.id);
					}
				}
			} else {
				this.txSuccessCount++;

				// Notify the callback of success
				const callback = this.queueCallbacks.get(transaction.id);
				if (callback) {
					callback(result);
					this.queueCallbacks.delete(transaction.id);
				}
			}

			// Continue processing remaining transactions for this account
			if (accountQueue.length > 0) {
				setImmediate(() => this.processAccountQueue(accountIndex));
			}
		} finally {
			// Release the lock
			this.accountProcessingLocks.set(accountIndex, false);
		}
	}

	/**
	 * Process all account queues in parallel.
	 * Each account processes its transactions sequentially to maintain sequence order.
	 */
	async processAllQueues(): Promise<void> {
		const accountPromises = Array.from(this.accountSequenceQueues.keys()).map(accountIndex => 
			this.processAccountQueue(accountIndex)
		);
		await Promise.all(accountPromises);
	}

	stop() {
		for (const intervalId of this.intervalIds) {
			clearInterval(intervalId);
		}
	}

	start() {
		this.stop();

		// Use a single interval to process all account queues in parallel with much faster processing
		this.intervalIds.push(
			debouncedInterval(async () => {
				await this.processAllQueues();
			}, Math.min(this.config.sedaChain.queueInterval, 100)), // Max 100ms for rapid processing
		);
	}

	static async fromConfig(config: AppConfig, cacheSequenceNumber = true): Promise<Result<SedaChain, unknown>> {
		const signerClients: SedaSigningCosmWasmClient[] = [];
		const signers: Signer[] = [];

		for (const [accountIndex] of Array(config.sedaChain.accountAmounts).entries()) {
			const signer = await Signer.fromConfig(config, accountIndex);
			const signingClient = await createSigningClient(signer, cacheSequenceNumber);

			if (signingClient.isErr) {
				return Result.err(signingClient.error);
			}

			signers.push(signer);
			signerClients.push(signingClient.value.client);
		}

		const protoClient = await createProtoQueryClient(config.sedaChain.rpc);
		const wasmStorageClient = await createWasmQueryClient(config.sedaChain.rpc);

		return Result.ok(new SedaChain(signers, signerClients, protoClient, wasmStorageClient, config));
	}

	async waitForSmartContractTransaction(
		executeMsg: ExecuteMsg,
		priority: TransactionPriority,
		attachedAttoSeda?: bigint,
		gasOptions?: GasOptions,
		forcedAccountIndex?: number,
		traceId?: string,
	): Promise<
		Result<IndexedTx, DataRequestExpired | AlreadyCommitted | AlreadyRevealed | RevealMismatch | RevealStarted | Error>
	> {
		// DEPRECATED: This method should not be used with block monitoring
		// It contains polling logic that we want to eliminate
		logger.warn("waitForSmartContractTransaction is deprecated - use queueSmartContractMessage with block monitoring instead", {
			id: traceId,
		});

		return new Promise(async (resolve) => {
			logger.trace(`Queueing smart contract transaction account index ${forcedAccountIndex ?? "default"}`, {
				id: traceId,
			});

			const transactionHash = await this.queueSmartContractMessage(
				executeMsg,
				priority,
				attachedAttoSeda,
				gasOptions,
				forcedAccountIndex,
				traceId,
			);

			if (transactionHash.isErr) {
				logger.trace(`Transaction could not be queued for ${traceId}: ${transactionHash.error}`, {
					id: traceId,
				});

				const error = narrowDownError(transactionHash.error);
				resolve(Result.err(error));
				return;
			}

			logger.trace("Transaction queued - relying on block monitoring for completion (no polling)", {
				id: traceId,
			});

			// For CLI commands that still need to wait, we provide a basic polling fallback
			// But for node operations, this should not be used - block monitoring handles completion
			const checkTransactionInterval = debouncedInterval(async () => {
				logger.trace("Checking if transaction is included in a block (legacy mode)", {
					id: traceId,
				});

				const transactionResult = await this.getTransaction(transactionHash.value);

				if (transactionResult.isErr) {
					logger.error(`Transaction could not be received for ${transactionHash.value}: ${transactionResult.error}`, {
						id: traceId,
					});

					const error = narrowDownError(transactionResult.error);
					clearInterval(checkTransactionInterval);
					resolve(Result.err(error));

					return;
				}

				if (transactionResult.value.isNothing) {
					logger.debug(`No tx result found yet for ${transactionHash.value}`, {
						id: traceId,
					});
					return;
				}

				logger.debug(`Tx result found for ${transactionHash.value}`, {
					id: traceId,
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
