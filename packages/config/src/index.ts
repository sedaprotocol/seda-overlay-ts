import { readFile } from "node:fs/promises";
import { tryAsync, trySync } from "@seda-protocol/utils";
import merge from "lodash.merge";
import { type Maybe, Result } from "true-myth";
import { SEDA_CONFIG_PATH } from "./constants";
import { type AppConfig, parseAppConfig } from "./models/app-config";

type DeepPartial<T> = {
	[P in keyof T]?: DeepPartial<T[P]>;
};

export async function loadConfig(
	configPath: string,
	overrides: DeepPartial<AppConfig> = {},
): Promise<Result<AppConfig, string[]>> {
	const configFileBuffer = await tryAsync(readFile(configPath));

	if (configFileBuffer.isErr) {
		return Result.err([`${configFileBuffer.error} at ${SEDA_CONFIG_PATH}`]);
	}

	const configFile = trySync<unknown>(() => JSON.parse(configFileBuffer.value.toString("utf-8")));

	if (configFile.isErr) {
		return Result.err([`${configFile.error}`]);
	}

	return parseAppConfig(merge(configFile.value, overrides));
}

export async function createConfig(_configPath: Maybe<string>, _home_dir: Maybe<string>, _network: string) {
	// Just creates a config at a given path. When the file exists it will not override it
}

export type { AppConfig };
export { parseAppConfig };
