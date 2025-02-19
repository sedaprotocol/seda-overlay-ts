import { EventEmitter } from "node:events";
import type { IndexedTx, SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import type { EncodeObject } from "@cosmjs/proto-signing";
import type { ProtobufRpcClient } from "@cosmjs/stargate";
import type { sedachain } from "@seda-protocol/proto-messages";
import { tryAsync } from "@seda-protocol/utils";
import type { ExecuteMsg, QueryMsg } from "@sedaprotocol/core-contract-schema";
import { debouncedInterval } from "@sedaprotocol/overlay-ts-common";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Maybe, Result } from "true-myth";
import { createProtoQueryClient, createWasmQueryClient } from "./query-client";
import { getTransaction, signAndSendTxSync } from "./sign-and-send-tx";
import { type ISigner, Signer } from "./signer";
import { createSigningClient } from "./signing-client";

const MAX_MESSAGES_PER_TRANSACTION = 1;
const TIME_BETWEEN_PROCESSING_QUEUE = 1;
const QUEUE_INTERVAL = 200;

type EventMap = {
	"tx-error": [string, TransactionMessage | undefined];
	"tx-success": [TransactionMessage, IndexedTx];
};

export interface TransactionMessage {
	id: string;
	message: EncodeObject;
	type: string;
}

interface InFlightTransaction {
	hash: string;
	details: TransactionMessage;
}

export class SedaChain extends EventEmitter<EventMap> {
	private transactionQueue: TransactionMessage[] = [];
	private inflight: InFlightTransaction[] = [];
	private intervalId?: Timer;

	private constructor(
		public signer: ISigner,
		private signerClient: SigningCosmWasmClient,
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

	async queueSmartContractMessage(id: string, executeMsg: ExecuteMsg) {
		const message = {
			typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
			value: {
				sender: this.getSignerAddress(),
				contract: await this.getCoreContractAddress(),
				funds: [],
				msg: Buffer.from(JSON.stringify(executeMsg)),
			},
		};

		this.queueMessages([
			{
				id,
				message,
				type: "contract",
			},
		]);
	}

	async queryContractSmart<T = unknown>(queryMsg: QueryMsg): Promise<Result<T, Error>> {
		const coreContractAddress = await this.getCoreContractAddress();

		return tryAsync<T>(() => this.signerClient.queryContractSmart(coreContractAddress, queryMsg));
	}

	async checkTransactions() {
		// Making sure we don't remove items in the array while looping over it
		const toRemoveIndexes: number[] = [];

		for (const [index, tx] of this.inflight.entries()) {
			const result = await getTransaction(this.signerClient, tx.hash);

			if (result.isErr) {
				this.inflight.splice(index, 1);
				this.emit("tx-error", result.error.message, tx.details);
				continue;
			}

			if (result.value.isNothing) {
				continue;
			}

			toRemoveIndexes.push(index);
			this.emit("tx-success", tx.details, result.value.value);
		}

		for (const index of toRemoveIndexes) {
			this.inflight.splice(index, 1);
		}
	}

	async processQueue() {
		const txMessages = this.transactionQueue.splice(0, MAX_MESSAGES_PER_TRANSACTION);

		// No need to send empty transactions
		if (txMessages.length === 0) {
			return;
		}

		const cosmosMessages = txMessages.map((msg) => msg.message);
		const result = await signAndSendTxSync(this.signerClient, this.signer.getAddress(), cosmosMessages);

		if (result.isErr) {
			logger.error(`Transaction failed: ${result.error}`);
			const error = result.error instanceof Error ? result.error.message : `${result.error}`;

			const messageIndexRegex = new RegExp(/message index: (\d+)/gm);
			const capturedGroup = Maybe.of(messageIndexRegex.exec(error));

			if (capturedGroup.isNothing) {
				this.emit("tx-error", error, undefined);
				return;
			}

			const messageIndex = Number(capturedGroup.value[1]);
			this.emit("tx-error", error, txMessages[messageIndex]);

			// Remove the failing transaction message
			txMessages.splice(messageIndex);

			// Re-queue the messages which didn't throw
			this.queueMessages(txMessages);
			return;
		}

		for (const txMessage of txMessages) {
			this.inflight.push({
				details: txMessage,
				hash: result.value,
			});
		}
	}

	stop() {
		clearInterval(this.intervalId);
	}

	start() {
		clearInterval(this.intervalId);
		let lastInterval = Date.now();

		this.intervalId = debouncedInterval(async () => {
			const now = Date.now();
			const timeBetweenLastInterval = now - lastInterval;

			this.checkTransactions();

			// Either process the queue when we have too many messages in the queue or
			// we haven't processed the queue in a while
			if (
				this.transactionQueue.length >= MAX_MESSAGES_PER_TRANSACTION ||
				timeBetweenLastInterval >= TIME_BETWEEN_PROCESSING_QUEUE
			) {
				lastInterval = now;
				await this.processQueue();
			}
		}, QUEUE_INTERVAL);
	}

	static async fromConfig(config: AppConfig): Promise<Result<SedaChain, unknown>> {
		const signer = await Signer.fromConfig(config);
		const protoClient = await createProtoQueryClient(config.sedaChain.rpc);
		const signingClient = await createSigningClient(signer);
		const wasmStorageClient = await createWasmQueryClient(config.sedaChain.rpc);

		if (signingClient.isErr) {
			return Result.err(signingClient.error);
		}

		return Result.ok(new SedaChain(signer, signingClient.value.client, protoClient, wasmStorageClient));
	}
}

export function waitForSmartContractTransaction(
	sedaChain: SedaChain,
	id: string,
	executeMsg: ExecuteMsg,
): Promise<Result<IndexedTx, Error>> {
	return new Promise(async (resolve) => {
		function onTxSuccess(txMessage: TransactionMessage, response: IndexedTx) {
			if (txMessage.id !== id) {
				return;
			}

			removeListeners();
			resolve(Result.ok(response));
		}

		function onTxError(error: string, txMessage: TransactionMessage | undefined) {
			if (!txMessage) {
				return;
			}

			if (txMessage.id !== id) {
				return;
			}

			removeListeners();
			resolve(Result.err(new Error(error)));
		}

		function removeListeners() {
			sedaChain.off("tx-success", onTxSuccess);
			sedaChain.off("tx-error", onTxError);
		}

		sedaChain.on("tx-success", onTxSuccess);
		sedaChain.on("tx-error", onTxError);

		await sedaChain.queueSmartContractMessage(id, executeMsg);
	});
}
