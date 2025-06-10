import { callVm, executeVm } from "@seda-protocol/vm";
import type { VmCallData, VmResult } from "@seda-protocol/vm";
import type { SedaChain, WorkerPool } from "@sedaprotocol/overlay-ts-common";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { type Maybe, Result } from "true-myth";
import type { DataRequest } from "../models/data-request";
import { OverlayVmAdapter } from "../overlay-vm-adapter";
import { Cache } from "../services/cache";
import { getVmVersion } from "../services/determine-vm-version" with { type: "macro" };
import { getOracleProgram } from "../services/get-oracle-program";
import { compile } from "./execute-worker/compile-worker";
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
	appConfig: AppConfig,
	sedaChain: SedaChain,
	vmWorkerPool: Maybe<WorkerPool>,
	compilerPool: Maybe<WorkerPool>,
	syncExecuteWorker: Maybe<WorkerPool>,
): Promise<Result<VmResultOverlay, Error>> {
	return executionResultCache.getOrFetch(`${dataRequest.id}_${dataRequest.height}`, async () => {
		logger.info("📦 Downloading Oracle Program...", {
			id: dataRequest.id,
		});
		const binary = await getOracleProgram(dataRequest.execProgramId, appConfig, sedaChain);

		if (binary.isErr) {
			return Result.err(new Error(`Could not load oracle program: ${binary.error}`));
		}

		if (binary.value.isNothing) {
			return Result.ok(createVmResultError(new Error(`Binary ${dataRequest.execProgramId} does not exist`)));
		}

		if (binary.value.value.fromCache) {
			logger.info("📦 Got Oracle Program from cache", {
				id: dataRequest.id,
			});
		} else {
			logger.info("📦 Downloaded Oracle Program", {
				id: dataRequest.id,
			});
		}

		const drExecGasLimit = dataRequest.execGasLimit / BigInt(dataRequest.replicationFactor);
		// Clamp the gas limit to the maximum allowed by node config
		const clampedGasLimit = clampGasLimit(drExecGasLimit, appConfig.node.maxGasLimit);

		const vmAdapter = new OverlayVmAdapter(
			{
				chainId: appConfig.sedaChain.chainId,
				coreContractAddress: await sedaChain.getCoreContractAddress(),
				dataRequestId: dataRequest.id,
				gasPrice: dataRequest.gasPrice,
				identityPrivateKey,
				appConfig,
				requestTimeout: appConfig.node.requestTimeout,
				totalHttpTimeLimit: appConfig.node.totalHttpTimeLimit,
			},
			sedaChain,
		);

		const oracleProgramBinary = binary.value.value.bytes;
		const cacheWasmId = `${dataRequest.execProgramId}_metered_${getVmVersion()}.wasm`;

		// We can do compilation in a seperate thread only if there is enough threads available
		// Otherwise we will not precompile the binary
		const binaryOrModule = await compilerPool.match<Promise<Buffer | WebAssembly.Module>>({
			Just: async (pool) => {
				const compiledModule = await pool.executeTask(async (worker) => {
					return compile(worker, oracleProgramBinary, {
						dir: `${appConfig.wasmCacheDir}`,
						id: cacheWasmId,
					});
				});

				return compiledModule;
			},
			Nothing: () => {
				return Promise.resolve(oracleProgramBinary);
			},
		});

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
				DR_GAS_PRICE: dataRequest.gasPrice.toString(),
				DR_EXEC_GAS_LIMIT: clampedGasLimit.toString(),
				DR_TALLY_GAS_LIMIT: dataRequest.tallyGasLimit.toString(),
				DR_MEMO: dataRequest.memo.toString("hex"),
				DR_PAYBACK_ADDRESS: dataRequest.paybackAddress.toString("hex"),
				TALLY_PROGRAM_ID: dataRequest.tallyProgramId,
				TALLY_INPUTS: dataRequest.tallyInputs.toString("hex"),
			},
			binary: binaryOrModule,
			gasLimit: clampedGasLimit,
			stderrLimit: appConfig.node.maxVmLogsSizeBytes,
			stdoutLimit: appConfig.node.maxVmLogsSizeBytes,
		};

		const result = await vmWorkerPool.match({
			Just: async (pool) => {
				return pool.executeTask(async (worker) => {
					return await callVm(callData, worker, vmAdapter);
				});
			},
			Nothing: async () => {
				if (syncExecuteWorker.isJust) {
					return syncExecuteWorker.value.executeTask(async (worker) => {
						return await executeDataRequestInWorker(worker, identityPrivateKey, dataRequest, appConfig, callData);
					});
				}

				return executeVm(callData, dataRequest.id, vmAdapter);
			},
		});

		return Result.ok({
			usedProxyPublicKeys: vmAdapter.usedProxyPublicKeys,
			// The Sync worker will return the result with the usedProxyPublicKeys
			...result,
		});
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
