import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tryAsync, trySync } from "@seda-protocol/utils";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { parseJSONC } from "confbox";
import merge from "lodash.merge";
import { type Maybe, Result } from "true-myth";
import { DEVNET_APP_CONFIG, MAINNET_APP_CONFIG, PLANET_APP_CONFIG, TESTNET_APP_CONFIG } from "./constants";
import { createAllDataFolders, resolveWithHomeDir } from "./home-dir";
import { type AppConfig, parseAppConfig } from "./models/app-config";
import type { DeepPartial } from "./types";

export async function loadConfig(
	configPath: Maybe<string>,
	network: string,
	homeDir: Maybe<string>,
	overrides: DeepPartial<AppConfig> = {},
): Promise<Result<AppConfig, string[]>> {
	const finalConfigPath = configPath.match({
		Just: (value) => resolve(value),
		Nothing: () => resolveWithHomeDir("config.jsonc", network, homeDir),
	});
	logger.info(`Config file: ${finalConfigPath}`);

	const configFileBuffer = await tryAsync(readFile(finalConfigPath));

	if (configFileBuffer.isErr) {
		if (configFileBuffer.error.message.includes("ENOENT")) {
			return Result.err([
				`Config file not found at ${finalConfigPath}, please set --config, -c or the env variable "SEDA_CONFIG_PATH"`,
			]);
		}

		return Result.err([`${configFileBuffer.error} at ${finalConfigPath}`]);
	}

	const configFile = trySync<unknown>(() => parseJSONC(configFileBuffer.value.toString("utf-8")));

	if (configFile.isErr) {
		return Result.err([`${configFile.error}`]);
	}

	const appConfig = await parseAppConfig(merge(configFile.value, overrides), network);

	if (appConfig.isOk) {
		logger.init(appConfig.value);
	}

	return appConfig;
}

export async function createConfig(
	configPath: Maybe<string>,
	homeDir: Maybe<string>,
	network: "testnet" | "devnet" | "planet" | "mainnet" | string,
): Promise<Result<string, Error>> {
	// Just creates a config at a given path. When the file exists it will not override it
	let config: DeepPartial<AppConfig> = {
		sedaChain: {
			rpc: "RPC_HERE",
			chainId: "seda-1-chainId-here",
			mnemonic: "YOUR SEDA MNEMONIC HERE",
		},
	};

	if (network === "testnet") {
		config = TESTNET_APP_CONFIG;
	} else if (network === "devnet") {
		config = DEVNET_APP_CONFIG;
	} else if (network === "planet") {
		config = PLANET_APP_CONFIG;
	} else if (network === "mainnet") {
		config = MAINNET_APP_CONFIG;
	}

	const foldersCreation = await createAllDataFolders(network, homeDir);
	if (foldersCreation.isErr) return Result.err(foldersCreation.error);

	const finalConfigPath = configPath.match({
		Just: (value) => resolve(value),
		Nothing: () => resolveWithHomeDir("config.jsonc", network, homeDir),
	});

	const fileExists = trySync(() => existsSync(finalConfigPath));
	if (fileExists.isErr) return Result.err(fileExists.error);

	if (fileExists.value) {
		return Result.err(new Error(`File ${finalConfigPath} already exists`));
	}

	const writeResult = await tryAsync(writeFile(finalConfigPath, JSON.stringify(config, null, 4)));
	if (writeResult.isErr) return Result.err(writeResult.error);

	return Result.ok(finalConfigPath);
}

export type { AppConfig };
export { parseAppConfig };
export { getAppVersions } from "./models/app-versions";
