import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { SedaChainService, asyncToEffect } from "@sedaprotocol/overlay-ts-common";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Effect, Either, Option } from "effect";

type OracleProgram = {
	bytes: Buffer;
	fromCache: boolean;
};

export function getOracleProgram(
	execProgramId: string,
	appConfig: AppConfig,
): Effect.Effect<Option.Option<OracleProgram>, Error, SedaChainService> {
	return Effect.gen(function* () {
		const wasmPath = resolve(appConfig.wasmCacheDir, `${execProgramId}.wasm`);
		const sedaChainService = yield* SedaChainService;
		const cachedWasmFile = yield* Effect.either(asyncToEffect(readFile(wasmPath)));

		if (Either.isRight(cachedWasmFile)) {
			return Option.some({ bytes: cachedWasmFile.right, fromCache: true });
		}

		const binary = yield* sedaChainService.getOracleProgram(execProgramId);
		const binaryBuffer = binary.pipe(Option.map((program) => Buffer.from(program.bytecode)));

		if (Option.isNone(binaryBuffer)) {
			return Option.none();
		}

		const writeResult = yield* Effect.either(asyncToEffect(writeFile(wasmPath, binaryBuffer.value)));

		if (Either.isLeft(writeResult)) {
			logger.error(`Could not cache WASM file. Will use memory: ${writeResult.left}`);
		}

		return Option.some({ bytes: binaryBuffer.value, fromCache: false });
	});
}
