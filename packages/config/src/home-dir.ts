import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { tryAsync } from "@seda-protocol/utils";
import { Maybe, Result } from "true-myth";

export function resolveWithHomeDir(path: string, network: string, homeDir: Maybe<string> = Maybe.nothing()): string {
	return homeDir.match({
		Just: (value) => {
			return resolve(value, ".seda", network, path);
		},
		Nothing: () => {
			const xdgHome = Maybe.of(process.env.XDG_DATA_HOME);

			if (xdgHome.isJust) {
				return resolve(xdgHome.value, ".seda", network, path);
			}

			const sedaHome = Maybe.of(process.env.SEDA_HOME);

			if (sedaHome.isJust) {
				return resolve(sedaHome.value, ".seda", network, path);
			}

			const osHome = homedir();
			return resolve(osHome, ".seda", network, path);
		},
	});
}

type DataDirectories = {
	dataDir: string;
	wasmCacheDir: string;
	logsDir: string;
	workersDir: string;
};

export async function createAllDataFolders(
	network: string,
	homeDir: Maybe<string> = Maybe.nothing(),
): Promise<Result<DataDirectories, Error>> {
	const dataDirPath = resolveWithHomeDir("", network, homeDir);
	const createdDataDir = await tryAsync(mkdir(dataDirPath, { recursive: true }));
	if (createdDataDir.isErr) return Result.err(createdDataDir.error);

	const wasmCacheDirPath = resolveWithHomeDir("wasm_cache", network, homeDir);
	const createdWasmCacheDir = await tryAsync(mkdir(wasmCacheDirPath, { recursive: true }));
	if (createdWasmCacheDir.isErr) return Result.err(createdWasmCacheDir.error);

	const logsDirPath = resolveWithHomeDir("logs", network, homeDir);
	const createdLogsDir = await tryAsync(mkdir(logsDirPath, { recursive: true }));
	if (createdLogsDir.isErr) return Result.err(createdLogsDir.error);

	const workersDirPath = resolveWithHomeDir("workers", "", homeDir);
	const createdWorkersDir = await tryAsync(mkdir(workersDirPath, { recursive: true }));
	if (createdWorkersDir.isErr) return Result.err(createdWorkersDir.error);

	return Result.ok({
		dataDir: dataDirPath,
		wasmCacheDir: wasmCacheDirPath,
		logsDir: logsDirPath,
		workersDir: workersDirPath,
	});
}
