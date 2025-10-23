import { type DrConfig, DrConfigSchema } from "@seda-protocol/dev-tools/libs/dev-tools/src/lib/services/get-dr-config";
import { tryAsync, tryParseSync } from "@seda-protocol/utils";
import type { SedaChain } from "@sedaprotocol/overlay-ts-common";
import { Cache } from "@sedaprotocol/overlay-ts-common";
import { createCoreQueryClient } from "@sedaprotocol/overlay-ts-common/src/seda/query-client";
import { Result } from "true-myth";

const DR_CONFIG_CACHE_TTL = 1000 * 60 * 10; // 10 minutes
const drConfigCache = new Cache<DrConfig>(DR_CONFIG_CACHE_TTL);

export async function getDrConfig(sedaChain: SedaChain): Promise<Result<DrConfig, Error>> {
	return drConfigCache.getOrFetch("drConfig", async () => {
		const coreQueryClient = await createCoreQueryClient(sedaChain.getRpcUrl());
		const response = await tryAsync(coreQueryClient.DataRequestConfig({}));

		if (response.isErr) {
			return Result.err(new Error(String(response.error)));
		}
		if (!response.value.dataRequestConfig) {
			return Result.err(new Error("No data request config found."));
		}

		const parseResult = tryParseSync(DrConfigSchema, response.value.dataRequestConfig);
		if (parseResult.isErr) {
			return Result.err(new Error(String(parseResult.error)));
		}
		return Result.ok(parseResult.value);
	});
}
