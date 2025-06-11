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
	drId: string;
}

export interface ExecuteMessage {
	appConfig: AppConfig;
	dataRequest: DataRequest;
	callData: VmCallData;
	identityPrivateKey: Buffer;
	eligibilityHeight: string;
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
					eligibilityHeight: BigInt(message.eligibilityHeight),
					gasPrice: message.dataRequest.gasPrice,
					identityPrivateKey: message.identityPrivateKey,
					requestTimeout: message.appConfig.node.requestTimeout,
					totalHttpTimeLimit: message.appConfig.node.totalHttpTimeLimit,
				},
				sedaChain.value,
			);

			const result = await executeVm(message.callData, message.dataRequest.id, vmAdapter);

			parentPort?.postMessage({
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
