import type { Staker as StakerProto } from "@seda-protocol/proto-messages/libs/proto-messages/gen/sedachain/core/v1/core";
import { tryAsync } from "@seda-protocol/utils";
import type { SedaChain } from "@sedaprotocol/overlay-ts-common";
import { Cache } from "@sedaprotocol/overlay-ts-common";
import { Maybe, Result } from "true-myth";

export interface Staker {
	memo: Maybe<Buffer>;
	tokensStaked: bigint;
	tokensPendingWithdrawal: bigint;
	publicKey: Buffer;
}

function transformStakerFromModule(staker: StakerProto): Staker {
	return {
		memo: staker.memo ? Maybe.just(Buffer.from(staker.memo, "base64")) : Maybe.nothing(),
		tokensStaked: BigInt(staker.staked),
		tokensPendingWithdrawal: BigInt(staker.pendingWithdrawal),
		publicKey: Buffer.from(staker.publicKey, "hex"),
	};
}

export async function getStaker(sedaChain: SedaChain, publicKey: string): Promise<Result<Maybe<Staker>, Error>> {
	const result = await tryAsync(sedaChain.getCoreQueryClient().Staker({ publicKey: publicKey }));

	if (result.isErr) {
		return Result.err(result.error);
	}

	if (!result.value.staker) {
		return Result.ok(Maybe.nothing());
	}

	return Result.ok(Maybe.just(transformStakerFromModule(result.value.staker)));
}

const STAKERS_CACHE_TTL = 1000 * 60 * 10; // 10 minutes
const stakersCache = new Cache<Staker[]>(STAKERS_CACHE_TTL);
const DEFAULT_LIMIT = 20;

/**
 * Fetches all stakers from the contract.
 *
 * @param sedaChain - The SedaChain instance to use for querying the contract.
 * @param limit - The number of stakers to fetch per page.
 * @returns A Result containing an array of Staker objects or an Error if the query fails.
 */
export async function getStakers(sedaChain: SedaChain, limit = DEFAULT_LIMIT): Promise<Result<Staker[], Error>> {
	return stakersCache.getOrFetch("stakers", async () => {
		const stakers: Staker[] = [];
		let offset = 0;

		async function fetchStakers(): Promise<Result<Staker[], Error>> {
			const result = await tryAsync(sedaChain.getCoreQueryClient().Executors({ limit: limit, offset: offset }));

			if (result.isErr) {
				return Result.err(result.error);
			}

			stakers.push(...result.value.executors.map((staker) => transformStakerFromModule(staker)));

			// If we got fewer results than requested, we're done (end of data)
			if (result.value.executors.length < limit) {
				return Result.ok(stakers);
			}

			// Otherwise, fetch the next page
			offset = stakers.length;
			return fetchStakers();
		}

		return fetchStakers();
	});
}
