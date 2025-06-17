import type { SedaChain } from "@sedaprotocol/overlay-ts-common";
import { Result } from "true-myth";
import { Cache } from "./cache";

const BLOCK_HEIGHT_CACHE_TTL = 2500; // 2.5 seconds
const blockHeightCache = new Cache<bigint>(BLOCK_HEIGHT_CACHE_TTL);

export async function getCurrentBlockHeight(sedaChain: SedaChain): Promise<Result<bigint, Error>> {
	return blockHeightCache.getOrFetch("blockHeight", async () => {
		const result = await sedaChain.getBlock();

		if (result.isErr) {
			return Result.err(result.error);
		}

		return Result.ok(BigInt(result.value.header.height));
	});
}
