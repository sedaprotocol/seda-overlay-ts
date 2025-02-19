import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tryAsync } from "@seda-protocol/utils";
import type { SedaChain } from "@sedaprotocol/overlay-ts-common";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Maybe, Result } from "true-myth";

export async function getOracleProgram(
	execProgramId: string,
	appConfig: AppConfig,
	sedaChain: SedaChain,
): Promise<Result<Maybe<Buffer>, Error>> {
	const wasmPath = resolve(appConfig.wasmCacheDir, `${execProgramId}.wasm`);
	const cachedWasmFile = await tryAsync(readFile(wasmPath));

	if (cachedWasmFile.isOk) {
		return Result.ok(Maybe.just(cachedWasmFile.value));
	}

	const binary = await tryAsync(sedaChain.getWasmStorageQueryClient().OracleProgram({ hash: execProgramId }));

	if (binary.isErr) {
		if (binary.error.message.includes("not found")) {
			return Result.ok(Maybe.nothing());
		}

		return Result.err(binary.error);
	}

	const binaryBuffer = Maybe.of(binary.value.oracleProgram?.bytecode).map((byteCode) => Buffer.from(byteCode));

	if (binaryBuffer.isNothing) {
		return Result.ok(Maybe.nothing());
	}

	const writeResult = await tryAsync(writeFile(wasmPath, binaryBuffer.value));

	if (writeResult.isErr) {
		logger.error(`Could not cache WASM file. Will use memory: ${writeResult.error}`);
	}

	return Result.ok(Maybe.just(binaryBuffer.value));
}
