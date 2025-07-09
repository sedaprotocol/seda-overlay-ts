import { type Worker, isMainThread, parentPort } from "node:worker_threads";
import { type VmCallData, executeVm } from "@seda-protocol/vm";
import { SedaChain } from "@sedaprotocol/overlay-ts-common";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { Maybe, Result, Unit } from "true-myth";
import type { DataRequest } from "../../models/data-request";
import { OverlayVmAdapter } from "../../overlay-vm-adapter";
import { type VmResultOverlay, createVmResultError } from "../execute";

export interface ExecuteResponse {
	result: VmResultOverlay;
	drId: string;
	type: "execute";
}

export interface ExecuteMessage {
	appConfig: AppConfig;
	dataRequest: DataRequest;
	callData: VmCallData;
	identityPrivateKey: Buffer;
	eligibilityHeight: string;
	type: "execute";
}

export interface WarmupMessage {
	id: string;
	appConfig: AppConfig;
	type: "warmup";
}

interface WarmupResponse {
	id: string;
	error?: Error;
	type: "warmup";
}

function startWorker() {
	let sedaChain: Maybe<SedaChain> = Maybe.nothing();

	parentPort?.on("message", async (message: ExecuteMessage | WarmupMessage) => {
		// First time we get a message, we need to create the SedaChain instance
		if (sedaChain.isNothing) {
			const sedaChainInstance = await SedaChain.fromConfig(message.appConfig);
			if (sedaChainInstance.isErr) {
				if (message.type === "execute") {
					parentPort?.postMessage({
						type: "execute",
						result: createVmResultError(sedaChainInstance.error as Error),
						drId: message.dataRequest.id,
					} as ExecuteResponse);
				} else {
					parentPort?.postMessage({
						type: "warmup",
						error: sedaChainInstance.error,
						id: message.id,
					} as WarmupResponse);
				}
				return;
			}

			sedaChain = Maybe.just(sedaChainInstance.value);

			if (message.type === "warmup") {
				parentPort?.postMessage({
					type: "warmup",
					id: message.id,
				} as WarmupResponse);
				return;
			}
		}

		// Should never happen, warmup should only be called once
		if (sedaChain.isJust && message.type === "warmup") {
			parentPort?.postMessage({
				type: "warmup",
				id: message.id,
			} as WarmupResponse);
			return;
		}

		if (sedaChain.isJust && message.type === "execute") {
			const traceId = `${message.dataRequest.id}`;

			const vmAdapter = new OverlayVmAdapter(
				{
					chainId: message.appConfig.sedaChain.chainId,
					appConfig: message.appConfig,
					coreContractAddress: await sedaChain.value.getCoreContractAddress(),
					dataRequestId: message.dataRequest.id,
					eligibilityHeight: BigInt(message.eligibilityHeight),
					gasPrice: message.dataRequest.postedGasPrice,
					identityPrivateKey: message.identityPrivateKey,
					totalHttpTimeLimit: message.appConfig.node.totalHttpTimeLimit,
				},
				sedaChain.value,
				traceId,
			);

			const result = await executeVm(message.callData, message.dataRequest.id, vmAdapter);

			parentPort?.postMessage({
				type: "execute",
				drId: message.dataRequest.id,
				result: {
					...result,
					usedProxyPublicKeys: vmAdapter.usedProxyPublicKeys,
				},
			} as ExecuteResponse);
		}
	});
}

if (!isMainThread) {
	startWorker();
}

export function executeDataRequestInWorker(
	worker: Worker,
	identityPrivateKey: Buffer,
	eligibilityHeight: bigint,
	dataRequest: DataRequest,
	appConfig: AppConfig,
	callData: VmCallData,
): Promise<VmResultOverlay> {
	return new Promise((resolve) => {
		const message: ExecuteMessage = {
			identityPrivateKey,
			dataRequest,
			appConfig,
			callData,
			eligibilityHeight: eligibilityHeight.toString(),
			type: "execute",
		};

		function handleMessage(response: ExecuteResponse) {
			// This is not our response, we ignore it
			// (This thread is shared by multiple data requests)
			if (response.drId !== dataRequest.id) {
				return;
			}

			worker.off("message", handleMessage);
			resolve(response.result);
		}

		worker.on("message", handleMessage);
		worker.postMessage(message);
	});
}

export function warmupWorker(worker: Worker, appConfig: AppConfig): Promise<Result<Unit, Error>> {
	return new Promise((resolve) => {
		const message: WarmupMessage = {
			id: Math.random().toString(),
			appConfig,
			type: "warmup",
		};

		function handleMessage(response: WarmupResponse) {
			if (response.id !== message.id) {
				return;
			}

			worker.off("message", handleMessage);
			resolve(response.error ? Result.err(response.error) : Result.ok(Unit));
		}

		worker.on("message", handleMessage);
		worker.postMessage(message);
	});
}
