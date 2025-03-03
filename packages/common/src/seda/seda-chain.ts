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
import { AlreadyCommitted, AlreadyRevealed, IncorrectAccountSquence, RevealMismatch } from "./errors";
import { DEFAULT_GAS, type GasOptions } from "./gas-options";
import { createProtoQueryClient, createWasmQueryClient } from "./query-client";
import { getTransaction, signAndSendTxSync } from "./sign-and-send-tx";
import { type ISigner, Signer } from "./signer";
import { type SedaSigningCosmWasmClient, createSigningClient } from "./signing-client";

const QUEUE_INTERVAL = 200;

type EventMap = {
	"tx-error": [string, TransactionMessage | undefined];
	"tx-success": [TransactionMessage, IndexedTx];
};

export interface TransactionMessage {
	id: string;
	message: EncodeObject;
	type: string;
	gasOptions?: GasOptions;
}

export class SedaChain extends EventEmitter<EventMap> {
	public transactionQueue: TransactionMessage[] = [];
	private queueCallbacks: Map<string, (value: Result<string, Error>) => void> = new Map();
	private intervalId?: Timer;
	private nonceId = 0;

	private constructor(
		public signer: ISigner,
		private signerClient: SedaSigningCosmWasmClient,
		private protoClient: ProtobufRpcClient,
		private wasmStorageQueryClient: sedachain.wasm_storage.v1.QueryClientImpl,
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

	async queueSmartContractMessage(
		id: string,
		executeMsg: ExecuteMsg,
		attachedAttoSeda?: bigint,
		gasOptions?: GasOptions,
	): Promise<Result<string, Error>> {
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

		const result = await signAndSendTxSync(this.signerClient, this.signer.getAddress(), [message], gasOptions);
		return result;
	}

	/**
	 * Processes a single transaction from the queue to maintain proper sequence numbers.
	 * In Cosmos blockchains, transactions must be processed sequentially with incrementing
	 * sequence numbers. This method ensures transactions are handled one at a time in order.
	 * @returns void
	 */
	async processQueue() {
		const txMessage = Maybe.of(this.transactionQueue.shift());
		if (txMessage.isNothing) return;

		const cosmosMessage = txMessage.value.message;
		const gasOption = txMessage.value.gasOptions ?? { gas: DEFAULT_GAS };
		const result = await signAndSendTxSync(this.signerClient, this.signer.getAddress(), [cosmosMessage], gasOption);

		if (result.isErr) {
			if (result.error instanceof IncorrectAccountSquence) {
				logger.warn(`Incorrect acccount sequence, adding tx back to the queue: ${result.error}`);	
				this.transactionQueue.push(txMessage.value);
				return;
			}

			logger.error(`Transaction failed: ${result.error}`);
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
		clearInterval(this.intervalId);
	}

	start() {
		this.stop();

		this.intervalId = debouncedInterval(async () => {
			await this.processQueue();
		}, QUEUE_INTERVAL);
	}

	static async fromConfig(config: AppConfig, cacheSequenceNumber = true): Promise<Result<SedaChain, unknown>> {
		const signer = await Signer.fromConfig(config);
		const protoClient = await createProtoQueryClient(config.sedaChain.rpc);
		const signingClient = await createSigningClient(signer, cacheSequenceNumber);
		const wasmStorageClient = await createWasmQueryClient(config.sedaChain.rpc);

		if (signingClient.isErr) {
			return Result.err(signingClient.error);
		}

		return Result.ok(new SedaChain(signer, signingClient.value.client, protoClient, wasmStorageClient));
	}
}

// const waitingHandlers = new Set<string>();
// let hack: SedaChain | undefined = undefined;

// setInterval(() => {
// 	if (hack) {
// 		console.log("[DEBUG]: hack.inflight ::: ", hack.inflight);
// 	}

// 	// The bug is that some of the events are never triggered..
// 	// Maybe we should remove the bundling of transactions (or put it behind a flag)
// 	console.log("[DEBUG]: waitingHandlers ::: ", waitingHandlers);
// }, 3000);

let nonce = 0n;

export function waitForSmartContractTransaction(
	sedaChain: SedaChain,
	id: string,
	executeMsg: ExecuteMsg,
	attachedAttoSeda?: bigint,
	gasOptions?: GasOptions,
): Promise<Result<IndexedTx, AlreadyCommitted | AlreadyRevealed | RevealMismatch | Error>> {
	// waitingHandlers.add(id);
	// hack = sedaChain;

	return new Promise(async (resolve) => {
		nonce += 1n;
		const transactionHash = await sedaChain.queueSmartContractMessage(
			nonce.toString(),
			executeMsg,
			attachedAttoSeda,
			gasOptions,
		);

		if (transactionHash.isErr) {
			resolve(Result.err(transactionHash.error));
			return;
		}

		const checkTransactionInterval = debouncedInterval(async () => {
			const transactionResult = await sedaChain.getTransaction(transactionHash.value);

			if (transactionResult.isErr) {
				logger.error(`Transaction could not be received: ${transactionResult.error}`);

				if (AlreadyCommitted.isError(transactionResult.error)) {
					clearInterval(checkTransactionInterval);
					resolve(Result.err(new AlreadyCommitted(transactionResult.error.message)));
				}

				if (RevealMismatch.isError(transactionResult.error)) {
					clearInterval(checkTransactionInterval);
					resolve(Result.err(new RevealMismatch(transactionResult.error.message)));
				}

				if (AlreadyRevealed.isError(transactionResult.error)) {
					clearInterval(checkTransactionInterval);
					resolve(Result.err(new AlreadyRevealed(transactionResult.error.message)));
				}

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
		}, 2000);
		// Add timeout handling
		// const timeout = setTimeout(() => {
		// 	removeListeners();
		// 	resolve(Result.err(new Error(`Transaction ${id} timed out after 1 minute`)));
		// }, 60_000);

		// function onTxSuccess(txMessage: TransactionMessage, response: IndexedTx) {
		// 	if (txMessage.id !== id) {
		// 		return;
		// 	}

		// 	clearTimeout(timeout);
		// 	removeListeners();
		// 	resolve(Result.ok(response));
		// }

		// function onTxError(error: string, txMessage: TransactionMessage | undefined) {
		// 	// Remove the txMessage check - handle all errors for this ID
		// 	if (txMessage && txMessage.id !== id) {
		// 		return;
		// 	}

		// 	clearTimeout(timeout);
		// 	removeListeners();
		// 	resolve(Result.err(new Error(error)));
		// }

		// function removeListeners() {
		// 	sedaChain.off("tx-success", onTxSuccess);
		// 	sedaChain.off("tx-error", onTxError);
		// 	waitingHandlers.delete(id);
		// }

		// sedaChain.on("tx-success", onTxSuccess);
		// sedaChain.on("tx-error", onTxError);

		// try {
		// 	await sedaChain.queueSmartContractMessage(id, executeMsg, attachedAttoSeda, gasOptions);
		// } catch (error) {
		// 	clearTimeout(timeout);
		// 	removeListeners();
		// 	resolve(Result.err(error instanceof Error ? error : new Error(String(error))));
		// }
	});
}
