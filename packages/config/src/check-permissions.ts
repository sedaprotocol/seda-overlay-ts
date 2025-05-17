import { constants } from "node:fs";
import { access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tryAsync } from "@sedaprotocol/overlay-ts-common";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Result, type Unit } from "true-myth";
import type { AppConfig } from "./models/app-config";

export async function checkFilePermissions(appConfig: AppConfig): Promise<Result<Unit, string>> {
	logger.info("Checking file permissions..");
	const wasmCacheDirAccess = await tryAsync<void>(() =>
		access(appConfig.wasmCacheDir, constants.R_OK | constants.W_OK),
	);
	if (wasmCacheDirAccess.isErr) {
		return Result.err(`Error checking permissions for ${appConfig.wasmCacheDir}: ${wasmCacheDirAccess.error}`);
	}

	const logsDirAccess = await tryAsync<void>(() => access(appConfig.logsDir, constants.R_OK | constants.W_OK));
	if (logsDirAccess.isErr) {
		return Result.err(`Error checking permissions for ${appConfig.logsDir}: ${logsDirAccess.error}`);
	}

	const workersDirAccess = await tryAsync<void>(() => access(appConfig.workersDir, constants.R_OK | constants.W_OK));
	if (workersDirAccess.isErr) {
		return Result.err(`Error checking permissions for ${appConfig.workersDir}: ${workersDirAccess.error}`);
	}

	// Just to make sure all the cache is still readable and the user didn't mess up..
	const wasmCacheDirFiles = await readdir(appConfig.wasmCacheDir);
	for (const file of wasmCacheDirFiles) {
		const filePath = join(appConfig.wasmCacheDir, file);
		const fileAccess = await tryAsync<void>(() => access(filePath, constants.R_OK));

		if (fileAccess.isErr) {
			return Result.err(`Error checking permissions for ${filePath}: ${fileAccess.error}`);
		}
	}

	logger.info("File permissions check passed.");

	return Result.ok();
}
