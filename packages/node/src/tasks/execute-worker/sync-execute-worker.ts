import { type Worker, isMainThread, parentPort } from "node:worker_threads";
import { type VmCallData, executeVm } from "@seda-protocol/vm";
import { SedaChain } from "@sedaprotocol/overlay-ts-common";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { Maybe } from "true-myth";
import type { DataRequest } from "../../models/data-request";
import { OverlayVmAdapter } from "../../overlay-vm-adapter";
import { type VmResultOverlay, createVmResultError } from "../execute";

export interface ExecuteResponse {
	result: VmResultOverlay;
}

export interface ExecuteMessage {
	appConfig: AppConfig;
	dataRequest: DataRequest;
	callData: VmCallData;
	identityPrivateKey: Buffer;
}

function startWorker() {
	let sedaChain: Maybe<SedaChain> = Maybe.nothing();

	parentPort?.on("message", async (message: ExecuteMessage) => {
		// First time we get a message, we need to create the SedaChain instance
		if (sedaChain.isNothing) {
			const sedaChainInstance = await SedaChain.fromConfig(message.appConfig);
			if (sedaChainInstance.isErr) {
				parentPort?.postMessage({
					result: createVmResultError(sedaChainInstance.error as Error),
				} as ExecuteResponse);
				return;
			}

			sedaChain = Maybe.just(sedaChainInstance.value);
		}

		if (sedaChain.isJust) {
			const vmAdapter = new OverlayVmAdapter(
				{
					chainId: message.appConfig.sedaChain.chainId,
					appConfig: message.appConfig,
					coreContractAddress: await sedaChain.value.getCoreContractAddress(),
					dataRequestId: message.dataRequest.id,
					gasPrice: message.dataRequest.gasPrice,
					identityPrivateKey: message.identityPrivateKey,
					timeout: message.appConfig.node.httpTimeout,
				},
				sedaChain.value,
			);

			const result = await executeVm(message.callData, message.dataRequest.id, vmAdapter);

			parentPort?.postMessage({
				result: {
					...result,
					usedProxyPublicKeys: vmAdapter.usePublicKeys,
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
		};

		function handleMessage(response: ExecuteResponse) {
			worker.off("message", handleMessage);
			resolve(response.result);
		}

		worker.on("message", handleMessage);
		worker.postMessage(message);
	});
}
