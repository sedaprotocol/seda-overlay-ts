import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { tryParseSync } from "@seda-protocol/utils";
import { Result } from "true-myth";
import * as v from "valibot";
import { IntervalsConfigSchema } from "./intervals-config";
import { NodeConfigSchema } from "./node-config";
import { type SedaChainConfig, SedaChainConfigSchema, createSedaChainConfig } from "./seda-chain-config";

export const AppConfigSchema = v.object({
	homeDir: v.optional(v.string(), "./.seda/planet/"),
	node: v.optional(NodeConfigSchema, {}),
	sedaChain: SedaChainConfigSchema,
	intervals: v.optional(IntervalsConfigSchema, {}),
});

export interface AppConfig extends v.InferOutput<typeof AppConfigSchema> {
	sedaChain: SedaChainConfig;
	wasmCacheDir: string;
}

export async function parseAppConfig(input: unknown): Promise<Result<AppConfig, string[]>> {
	const config = tryParseSync(AppConfigSchema, input, {
		abortEarly: false,
	});

	if (config.isErr) {
		const messages = config.error.map((error) => {
			const path = error.path?.map((p) => p.key).join(".") || "";
			const issues = error.issues?.map((issue) => issue.message) ?? [];
			return `Failed to parse config: ${error.message} at $.${path} ${issues.map((issue) => `\n${issue}`)}`;
		});

		return Result.err(messages);
	}

	const homeDirPath = resolve(config.value.homeDir);
	const wasmCacheDirPath = resolve(homeDirPath, "wasm_cache");
	await mkdir(wasmCacheDirPath, { recursive: true });

	return Result.ok({
		...config.value,
		homeDir: homeDirPath,
		wasmCacheDir: wasmCacheDirPath,
		sedaChain: createSedaChainConfig(config.value.sedaChain),
	});
}
