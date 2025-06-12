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
	signerIndex: number;
}

export class SedaChain extends EventEmitter<EventMap> {
	public transactionQueue: TransactionMessage[] = [];
	private queueCallbacks: Map<string, (value: Result<string, Error>) => void> = new Map();
	private intervalIds: Timer[] = [];
	private nonceId = 0;

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
		for (const message of messages) {
			this.transactionQueue.push(message);
		}
	}

	async getTransaction(txHash: string, accountIndex = 0) {
		return getTransaction(this.signerClients[accountIndex], txHash);
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
		attachedAttoSeda?: bigint,
		gasOptions?: GasOptions,
	): Promise<Result<string, Error>> {
		return new Promise(async (resolve) => {
			this.nonceId += 1;

			const signerIndex = this.nonceId % this.signers.length;

			const message = {
				typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
				value: {
					sender: this.getSignerAddress(signerIndex),
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
					signerIndex,
				},
			]);

			this.queueCallbacks.set(this.nonceId.toString(), resolve);
		});
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
		const txMessageIndex = this.transactionQueue.findIndex((tx) => tx.signerIndex === accountIndex);
		if (txMessageIndex === -1) return Maybe.nothing();

		const txMessage = this.transactionQueue.splice(txMessageIndex, 1)[0];
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

		const cosmosMessage = txMessage.value.message;
		const gasOption = txMessage.value.gasOptions ?? { gas: this.config.sedaChain.gas };
		const result = await signAndSendTxSync(
			this.config.sedaChain,
			this.signerClients[txMessage.value.signerIndex],
			this.getSignerAddress(txMessage.value.signerIndex),
			[cosmosMessage],
			gasOption,
			this.config.sedaChain.memo,
		);

		if (result.isErr) {
			if (result.error instanceof IncorrectAccountSquence) {
				logger.warn(`Incorrect account sequence, adding tx back to the queue: ${result.error}`);
				this.txRetryCount++;
				this.transactionQueue.push(txMessage.value);
				return;
			}

			this.txFailureCount++;
			logger.error(`Transaction failed: ${result.error}`);
		} else {
			this.txSuccessCount++;
		}

		const callback = Maybe.of(this.queueCallbacks.get(txMessage.value.id));

		if (callback.isNothing) {
			logger.error(`Could not find callback for message id: ${txMessage.value.id}: ${txMessage.value}`);
			return;
		}

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

		// const signer = await Signer.fromConfig(config);
		const protoClient = await createProtoQueryClient(config.sedaChain.rpc);
		// const signingClient = await createSigningClient(signer, cacheSequenceNumber);
		const wasmStorageClient = await createWasmQueryClient(config.sedaChain.rpc);

		return Result.ok(new SedaChain(signers, signerClients, protoClient, wasmStorageClient, config));
	}

	async waitForSmartContractTransaction(
		executeMsg: ExecuteMsg,
		attachedAttoSeda?: bigint,
		gasOptions?: GasOptions,
	): Promise<
		Result<IndexedTx, DataRequestExpired | AlreadyCommitted | AlreadyRevealed | RevealMismatch | RevealStarted | Error>
	> {
		return new Promise(async (resolve) => {
			const transactionHash = await this.queueSmartContractMessage(executeMsg, attachedAttoSeda, gasOptions);

			if (transactionHash.isErr) {
				const error = narrowDownError(transactionHash.error);
				resolve(Result.err(error));
				return;
			}

			const checkTransactionInterval = debouncedInterval(async () => {
				const transactionResult = await this.getTransaction(transactionHash.value);

				if (transactionResult.isErr) {
					logger.error(`Transaction could not be received: ${transactionResult.error}`, {
						id: transactionHash.value,
					});

					const error = narrowDownError(transactionResult.error);
					clearInterval(checkTransactionInterval);
					resolve(Result.err(error));

					return;
				}

				if (transactionResult.value.isNothing) {
					logger.debug("No tx result found yet", {
						id: transactionHash.value,
					});
					return;
				}

				logger.debug("Tx result found", {
					id: transactionHash.value,
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
