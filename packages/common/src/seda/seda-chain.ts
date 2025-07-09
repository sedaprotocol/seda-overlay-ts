import type { IndexedTx } from "@cosmjs/cosmwasm-stargate";
import type { Coin, EncodeObject } from "@cosmjs/proto-signing";
import type { Block, ProtobufRpcClient } from "@cosmjs/stargate";
import type { sedachain } from "@seda-protocol/proto-messages";
import { tryAsync } from "@seda-protocol/utils";
import type { ExecuteMsg, QueryMsg } from "@sedaprotocol/core-contract-schema";
import { debouncedInterval, getBlock, getCurrentBlockHeight } from "@sedaprotocol/overlay-ts-common";
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
	public lowPriorityTransactionQueue: TransactionMessage[] = [];
	public highPriorityTransactionQueue: TransactionMessage[] = [];
	private queueCallbacks: Map<string, (value: Result<string, Error>) => void> = new Map();
	private intervalIds: Timer[] = [];
	private nonceId = 0;

	// Metrics:
	private txSuccessCount = 0;
	private txFailureCount = 0;
	private txRetryCount = 0;

	// The last block height we've searched for a transaction in
	private txLastSearchedBlockHeight = new Map<string, { start: number; current: number }>();

	private constructor(
		public signers: ISigner[],
		public signerClients: SedaSigningCosmWasmClient[],
		private protoClient: ProtobufRpcClient,
		private wasmStorageQueryClient: sedachain.wasm_storage.v1.QueryClientImpl,
		private config: AppConfig,
	) {
		super();
	}

	getRpcUrl() {
		return this.config.sedaChain.rpc;
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

	async getBalance(accountIndex = 0, token = "aseda"): Promise<Result<Coin, Error>> {
		const address = this.getSignerAddress(accountIndex);
		const balance = await tryAsync(async () => this.signerClients[accountIndex].getBalance(address, token));

		if (balance.isErr) {
			return Result.err(
				new Error(`Could not get balance for account ${address} (index: ${accountIndex}): ${balance.error}`),
			);
		}

		return balance;
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
		for (const message of messages) {
			if (message.priority === TransactionPriority.HIGH) {
				// High priority transactions should be at the front of the queue
				this.highPriorityTransactionQueue.push(message);
				continue;
			}

			// Low priority transactions should be at the back of the queue
			this.lowPriorityTransactionQueue.push(message);
		}
	}

	/**
	 * Gets a transaction from the chain. It first tries to get the transaction by indexing the block.
	 * When the transaction is not found in x blocks it will directly get the transaction by polling getTx
	 * (This is to prevent slowdowns in the block indexing)
	 *
	 * @param txHash - The hash of the transaction to get
	 * @param accountIndex - The index of the account to use for the transaction (Can be kept 0 in most cases)
	 *
	 */
	async getTransaction(txHash: string, accountIndex = 0) {
		if (this.config.sedaChain.disableTransactionBlockSearch) {
			return getTransaction(this.signerClients[accountIndex], txHash);
		}

		const lastSearchedInBlock = Maybe.of(this.txLastSearchedBlockHeight.get(txHash));

		if (lastSearchedInBlock.isNothing) {
			// First time we're searching for this transaction, so we need to check if it's in the current block
			const currentBlockHeight = await getCurrentBlockHeight(this);

			if (currentBlockHeight.isErr) {
				logger.error(`Error getting current block height: ${currentBlockHeight.error}`, {
					id: txHash,
				});

				return Result.ok(Maybe.nothing());
			}

			const block = await getBlock(this, Number(currentBlockHeight.value));

			if (block.isErr) {
				logger.error(`Error getting block for current height ${currentBlockHeight.value}: ${block.error}`, {
					id: txHash,
				});

				// We only want to return an error on transaction level, not on the block level
				return Result.ok(Maybe.nothing());
			}

			if (block.value.isNothing) {
				logger.trace(`No block found for current height ${currentBlockHeight.value}`, {
					id: txHash,
				});

				return Result.ok(Maybe.nothing());
			}

			const isInBlock = block.value.value.block.txIds.some((txId) => txId === txHash.toUpperCase());

			if (!isInBlock) {
				logger.trace(
					`Transaction not found in current block ${currentBlockHeight.value}, fullyIndexed: ${block.value.value.fullyIndexed}`,
					{
						id: txHash,
					},
				);

				// The block is fully indexed, so we can set the last searched block height
				// Otherwise we need to wait for the block to be fully indexed before continuing to the next block
				if (block.value.value.fullyIndexed) {
					this.txLastSearchedBlockHeight.set(txHash, {
						start: currentBlockHeight.value,
						current: currentBlockHeight.value,
					});
				}

				return Result.ok(Maybe.nothing());
			}

			logger.trace(`Transaction found in block ${currentBlockHeight.value}`, {
				id: txHash,
			});

			this.txLastSearchedBlockHeight.delete(txHash);
			return getTransaction(this.signerClients[accountIndex], txHash);
		}

		// We've already searched for this transaction in the block, so we need to check if it's in the next block
		const blockFetchResult = await getBlock(this, Number(lastSearchedInBlock.value.current) + 1);

		if (blockFetchResult.isErr) {
			logger.error(
				`Error getting block for height ${lastSearchedInBlock.value.current + 1}: ${blockFetchResult.error}`,
				{
					id: txHash,
				},
			);

			// We only want to return an error on transaction level, not on the block level
			return Result.ok(Maybe.nothing());
		}

		if (blockFetchResult.value.isNothing) {
			logger.trace(`No block found for height ${lastSearchedInBlock.value.current + 1}`, {
				id: txHash,
			});

			return Result.ok(Maybe.nothing());
		}

		const isInBlock = blockFetchResult.value.value.block.txIds.some((txId) => txId === txHash.toUpperCase());

		if (!isInBlock) {
			logger.trace(
				`Transaction not found in block ${lastSearchedInBlock.value.current + 1}, fullyIndexed: ${blockFetchResult.value.value.fullyIndexed}`,
				{
					id: txHash,
				},
			);

			// The block is fully indexed, so we can set the last searched block height
			// Otherwise we need to wait for the block to be fully indexed before continuing to the next block
			if (blockFetchResult.value.value.fullyIndexed) {
				this.txLastSearchedBlockHeight.set(txHash, {
					start: lastSearchedInBlock.value.start,
					current: blockFetchResult.value.value.block.header.height,
				});
			}

			// If the difference is a couple of blocks we should just fetch the transaction and see if it exists.
			// Safety measure to prevent slow indexing of RPC nodes
			const diff = blockFetchResult.value.value.block.header.height - lastSearchedInBlock.value.start;
			if (diff >= this.config.sedaChain.transactionBlockSearchThreshold)
				return getTransaction(this.signerClients[accountIndex], txHash);

			return Result.ok(Maybe.nothing());
		}

		logger.trace(`Transaction found in block ${lastSearchedInBlock.value.current + 1}`, {
			id: txHash,
		});

		this.txLastSearchedBlockHeight.delete(txHash);
		// It's in the block so we can fetch the transaction
		return getTransaction(this.signerClients[accountIndex], txHash);
	}

	async getBlock(height?: number, accountIndex = 0): Promise<Result<Block, Error>> {
		return tryAsync<Block>(() => this.signerClients[accountIndex].getBlock(height));
	}

	getTransactionStats() {
		return {
			successCount: this.txSuccessCount,
			failureCount: this.txFailureCount,
			pendingCount: this.lowPriorityTransactionQueue.length + this.highPriorityTransactionQueue.length,
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

			let accountIndex = this.nonceId % this.signers.length;

			// Some cases like staking, unstaking require a specific account index
			// this is because most of the time index 0 has all the funds
			if (forcedAccountIndex !== undefined) {
				accountIndex = forcedAccountIndex;
			}

			logger.trace(`Using account index ${accountIndex} for transaction (forced: ${forcedAccountIndex ?? "false"})`, {
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

	private getNextTransaction(accountIndex: number): Maybe<TransactionMessage> {
		const txMessageIndex = this.highPriorityTransactionQueue.findIndex((tx) => tx.accountIndex === accountIndex);

		if (txMessageIndex === -1) {
			const txMessageIndex = this.lowPriorityTransactionQueue.findIndex((tx) => tx.accountIndex === accountIndex);
			// When there are not low priority transactions, return nothing
			// NOTE: We could take just a random high priority transaction instead and rewrite the account index
			if (txMessageIndex === -1) return Maybe.nothing();

			const txMessage = this.lowPriorityTransactionQueue.splice(txMessageIndex, 1)[0];
			return Maybe.just(txMessage);
		}

		const txMessage = this.highPriorityTransactionQueue.splice(txMessageIndex, 1)[0];
		return Maybe.just(txMessage);
	}

	/**
	 * Processes a single transaction from the queue to maintain proper sequence numbers.
	 * In Cosmos blockchains, transactions must be processed sequentially with incrementing
	 * sequence numbers. This method ensures transactions are handled one at a time in order.
	 * @returns void
	 */
	async processQueue(accountIndex: number) {
		const txMessage = this.getNextTransaction(accountIndex);
		if (txMessage.isNothing) return;

		logger.trace(
			`Processing transaction on address ${this.getSignerAddress(txMessage.value.accountIndex)} and account index ${txMessage.value.accountIndex}`,
			{
				id: txMessage.value.traceId,
			},
		);

		const cosmosMessage = txMessage.value.message;
		const gasOption = txMessage.value.gasOptions ?? { gas: this.config.sedaChain.gas };

		const result = await signAndSendTxSync(
			this.config.sedaChain,
			this.signerClients[txMessage.value.accountIndex],
			this.getSignerAddress(txMessage.value.accountIndex),
			[cosmosMessage],
			gasOption,
			this.config.sedaChain.memo,
			txMessage.value.traceId,
		);

		if (result.isErr) {
			if (result.error instanceof IncorrectAccountSquence) {
				logger.warn(`Incorrect account sequence, adding tx back to the queue: ${result.error}`, {
					id: txMessage.value.traceId,
				});

				this.txRetryCount++;

				if (txMessage.value.priority === TransactionPriority.HIGH) {
					this.highPriorityTransactionQueue.push(txMessage.value);
				} else {
					this.lowPriorityTransactionQueue.push(txMessage.value);
				}
				return;
			}

			this.txFailureCount++;
			logger.warn(`Transaction failed: ${result.error}`, {
				id: txMessage.value.traceId,
			});
		} else {
			this.txSuccessCount++;
		}

		const callback = Maybe.of(this.queueCallbacks.get(txMessage.value.id));

		if (callback.isNothing) {
			logger.error(`Could not find callback for message id: ${txMessage.value.id}: ${txMessage.value}`, {
				id: txMessage.value.traceId,
			});
			return;
		}

		logger.trace("Transaction processed", {
			id: txMessage.value.traceId,
		});

		callback.value(result);
		this.queueCallbacks.delete(txMessage.value.id);
	}

	stop() {
		for (const intervalId of this.intervalIds) {
			clearInterval(intervalId);
		}
	}

	start() {
		this.stop();

		for (const [accountIndex] of this.signerClients.entries()) {
			this.intervalIds.push(
				debouncedInterval(async () => {
					await this.processQueue(accountIndex);
				}, this.config.sedaChain.queueInterval),
			);
		}
	}

	static async fromConfig(config: AppConfig, cacheSequenceNumber = true): Promise<Result<SedaChain, Error>> {
		const signerClients: SedaSigningCosmWasmClient[] = [];
		const signers: Signer[] = [];

		for (const [accountIndex] of Array(config.sedaChain.accountAmounts).entries()) {
			const signer = await Signer.fromConfig(config, accountIndex);

			if (signer.isErr) {
				return Result.err(signer.error);
			}

			const signingClient = await createSigningClient(signer.value, cacheSequenceNumber, {
				followRedirects: config.sedaChain.followHttpRedirects,
				redirectTtlMs: config.sedaChain.httpRedirectTtlMs,
			});

			if (signingClient.isErr) {
				return Result.err(signingClient.error);
			}

			signers.push(signer.value);
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

			logger.trace("Waiting for smart contract transaction to be included in a block", {
				id: traceId,
			});

			const checkTransactionInterval = debouncedInterval(async () => {
				logger.trace("Checking if transaction is included in a block", {
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
