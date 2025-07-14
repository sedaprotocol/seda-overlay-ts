import { tryParseSync } from "@seda-protocol/utils";
import { Maybe, Result } from "true-myth";
import * as v from "valibot";
import { checkFilePermissions } from "../check-permissions";
import { createAllDataFolders } from "../home-dir";
import { getAppVersions } from "./app-versions" with { type: "macro" };
import { HttpServerConfigSchema } from "./http-server-config";
import { IntervalsConfigSchema } from "./intervals-config";
import { NodeConfigSchema } from "./node-config";
import { type SedaChainConfig, SedaChainConfigSchema, createSedaChainConfig } from "./seda-chain-config";

export const AppConfigSchema = v.object({
	homeDir: v.optional(v.string()),
	node: v.optional(NodeConfigSchema, {}),
	sedaChain: SedaChainConfigSchema,
	intervals: v.optional(IntervalsConfigSchema, {}),
	httpServer: v.optional(HttpServerConfigSchema, {}),
});

export interface AppConfig extends v.InferOutput<typeof AppConfigSchema> {
	sedaChain: SedaChainConfig;
	wasmCacheDir: string;
	logsDir: string;
	workersDir: string;
	version: string;
	vmVersion: string;
}

export async function parseAppConfig(input: unknown, network: string): Promise<Result<AppConfig, string[]>> {
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

	const dataDirPaths = await createAllDataFolders(network, Maybe.of(config.value.homeDir));
	if (dataDirPaths.isErr) return Result.err([dataDirPaths.error.message]);

	const sedaChainConfig = createSedaChainConfig(config.value.sedaChain);
	if (sedaChainConfig.isErr) {
		return Result.err([sedaChainConfig.error.message]);
	}

	const appVersions = getAppVersions();
	const appConfig: AppConfig = {
		...config.value,
		wasmCacheDir: dataDirPaths.value.wasmCacheDir,
		sedaChain: sedaChainConfig.value,
		logsDir: dataDirPaths.value.logsDir,
		workersDir: dataDirPaths.value.workersDir,
		version: appVersions.overlay,
		vmVersion: appVersions.vm,
	};

	// Do one last check to ensure all folders have the correct permissions
	const filePermissions = await checkFilePermissions(appConfig);
	if (filePermissions.isErr) return Result.err([filePermissions.error]);

	return Result.ok(appConfig);
}
