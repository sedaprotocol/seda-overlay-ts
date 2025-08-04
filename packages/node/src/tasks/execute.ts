import type { VmCallData, VmResult } from "@seda-protocol/vm";
import type { SedaChainService, WorkerPool } from "@sedaprotocol/overlay-ts-common";
import { Cache, effectToAsyncResult } from "@sedaprotocol/overlay-ts-common";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Effect, type Layer, Option } from "effect";
import { Result } from "true-myth";
import type { DataRequest } from "../models/data-request";
import { getVmVersion } from "../services/determine-vm-version" with { type: "macro" };
import { getOracleProgram } from "../services/get-oracle-program";
import { executeDataRequestInWorker } from "./execute-worker/sync-execute-worker";

export interface VmResultOverlay extends VmResult {
	usedProxyPublicKeys: string[];
}

const TERA_GAS = 1_000_000_000_000n;

export function createVmResultError(error: Error): VmResultOverlay {
	return {
		exitCode: 1,
		stderr: error.message.toString(),
		stdout: "",
		result: new Uint8Array(),
		usedProxyPublicKeys: [],
		gasUsed: TERA_GAS * 5n,
	};
}

// 14 seconds execution cache
const executionResultCache = new Cache<VmResultOverlay>(14_000);

export async function executeDataRequest(
	identityPrivateKey: Buffer,
	dataRequest: DataRequest,
	eligibilityHeight: bigint,
	appConfig: AppConfig,
	sedaChain: Layer.Layer<SedaChainService>,
	syncExecuteWorker: WorkerPool,
): Promise<Result<VmResultOverlay, Error>> {
	return executionResultCache.getOrFetch(`${dataRequest.id}_${dataRequest.height}`, async () => {
		logger.debug("📦 Downloading Oracle Program...", {
			id: dataRequest.id,
		});
		const binary = await effectToAsyncResult(
			getOracleProgram(dataRequest.execProgramId, appConfig).pipe(Effect.provide(sedaChain)),
		);

		if (binary.isErr) {
			return Result.err(new Error(`Could not load oracle program: ${binary.error}`));
		}

		if (Option.isNone(binary.value)) {
			return Result.ok(createVmResultError(new Error(`Binary ${dataRequest.execProgramId} does not exist`)));
		}

		if (binary.value.value.fromCache) {
			logger.debug("📦 Got Oracle Program from cache", {
				id: dataRequest.id,
			});
		} else {
			logger.debug("📦 Downloaded Oracle Program", {
				id: dataRequest.id,
			});
		}

		const drExecGasLimit = dataRequest.execGasLimit / BigInt(dataRequest.replicationFactor);
		// Clamp the gas limit to the maximum allowed by node config
		const clampedGasLimit = clampGasLimit(drExecGasLimit, appConfig.node.maxGasLimit);
		const oracleProgramBinary = binary.value.value.bytes;
		const cacheWasmId = `${dataRequest.execProgramId}_metered_${getVmVersion()}.wasm`;

		const callData: VmCallData = {
			args: [dataRequest.execInputs.toString("hex")],
			vmMode: "exec",
			cache: {
				dir: `${appConfig.wasmCacheDir}`,
				id: cacheWasmId,
			},
			envs: {
				VM_MODE: "dr",
				DR_ID: dataRequest.id,
				DR_HEIGHT: dataRequest.height.toString(),
				EXEC_PROGRAM_ID: dataRequest.execProgramId,
				DR_REPLICATION_FACTOR: dataRequest.replicationFactor.toString(),
				DR_GAS_PRICE: dataRequest.postedGasPrice.toString(),
				DR_EXEC_GAS_LIMIT: clampedGasLimit.toString(),
				DR_TALLY_GAS_LIMIT: dataRequest.tallyGasLimit.toString(),
				DR_MEMO: dataRequest.memo.toString("hex"),
				DR_PAYBACK_ADDRESS: dataRequest.paybackAddress.toString("hex"),
				TALLY_PROGRAM_ID: dataRequest.tallyProgramId,
				TALLY_INPUTS: dataRequest.tallyInputs.toString("hex"),
			},
			binary: oracleProgramBinary,
			gasLimit: clampedGasLimit,
			stderrLimit: appConfig.node.maxVmLogsSizeBytes,
			stdoutLimit: appConfig.node.maxVmLogsSizeBytes,
		};

		logger.trace("Executing data request", {
			id: dataRequest.id,
		});

		const result = await syncExecuteWorker.executeTask(async (worker) => {
			return await executeDataRequestInWorker(
				worker,
				identityPrivateKey,
				eligibilityHeight,
				dataRequest,
				appConfig,
				callData,
			);
		});

		logger.trace("Data request executed", {
			id: dataRequest.id,
		});

		return Result.ok(result);
	});
}

/**
 * Clamps the gas limit to ensure it doesn't exceed the maximum allowed value
 * @param gasLimit The requested gas limit
 * @param maxGasLimit The maximum allowed gas limit from config
 * @returns The clamped gas limit
 */
function clampGasLimit(gasLimit: bigint, maxGasLimit: bigint): bigint {
	return gasLimit > maxGasLimit ? maxGasLimit : gasLimit;
}
