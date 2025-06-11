import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { glob } from "glob";
import { getVmVersion } from "../services/determine-vm-version" with { type: "macro" };

export async function clearWasmCache(appConfig: AppConfig) {
	const wasmFiles = await glob(`!(**/*_metered_${getVmVersion()}.wasm)`, {
		cwd: appConfig.wasmCacheDir,
	});


	console.log('[DEBUG]: wasmFiles ::: ', wasmFiles);
	process.exit(0);
	// logger.info(`Clearing wasm cache: ${wasmFiles.join(", ")}`);
}

export function createWasmCacheId(execProgramId: string) {
	return `${execProgramId}_metered_${getVmVersion()}.wasm`;
}