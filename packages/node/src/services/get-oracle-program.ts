import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { metricsHelpers, tryAsync } from "@sedaprotocol/overlay-ts-common";
import type { SedaChain } from "@sedaprotocol/overlay-ts-common";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Maybe, Result } from "true-myth";

type OracleProgram = {
	bytes: Buffer;
	fromCache: boolean;
};

export async function getOracleProgram(
	execProgramId: string,
	appConfig: AppConfig,
	sedaChain: SedaChain,
): Promise<Result<Maybe<OracleProgram>, Error>> {
	const wasmPath = resolve(appConfig.wasmCacheDir, `${execProgramId}.wasm`);
	const cachedWasmFile = await tryAsync(() => readFile(wasmPath));

	if (cachedWasmFile.isOk) {
		return Result.ok(Maybe.just({ bytes: cachedWasmFile.value, fromCache: true }));
	}

	const binary = await tryAsync(() => sedaChain.getWasmStorageQueryClient().OracleProgram({ hash: execProgramId }));

	if (binary.isErr) {
		if (typeof binary.error === "string" && binary.error.includes("not found")) {
			return Result.ok(Maybe.nothing());
		}
		return Result.err(new Error(binary.error.toString()));
	}

	const binaryBuffer = Maybe.of((binary.value as any)?.oracleProgram?.bytecode).map((byteCode) =>
		Buffer.from(byteCode),
	);

	if (binaryBuffer.isNothing) {
		return Result.ok(Maybe.nothing());
	}

	const writeResult = await tryAsync(() => writeFile(wasmPath, binaryBuffer.value));

	if (writeResult.isErr) {
		logger.error(`Could not cache WASM file. Will use memory: ${writeResult.error}`);

		// HIGH: Disk write failure - could not write to disk
		metricsHelpers.recordHighPriorityError("disk_write", new Error(writeResult.error.toString()), {
			oracle_program_hash: execProgramId,
			cache_path: wasmPath,
			reason: "wasm_cache_write_failed",
		});
	}

	return Result.ok(Maybe.just({ bytes: binaryBuffer.value, fromCache: false }));
}
