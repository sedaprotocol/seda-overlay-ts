import type { GetExecutorsResponse, Staker as StakerFromContract } from "@sedaprotocol/core-contract-schema";
import type { SedaChain } from "@sedaprotocol/overlay-ts-common";
import { Cache } from "@sedaprotocol/overlay-ts-common";
import { Maybe, Result } from "true-myth";

export interface Staker {
	memo: Maybe<Buffer>;
	tokensStaked: bigint;
	tokensPendingWithdrawal: bigint;
	publicKey: Buffer;
}

function transformStakerFromContract(staker: StakerFromContract, publicKey: string): Staker {
	return {
		memo: staker.memo ? Maybe.just(Buffer.from(staker.memo, "base64")) : Maybe.nothing(),
		tokensStaked: BigInt(staker.tokens_staked),
		tokensPendingWithdrawal: BigInt(staker.tokens_pending_withdrawal),
		publicKey: Buffer.from(publicKey, "hex"),
	};
}

export async function getStaker(sedaChain: SedaChain, publicKey: string): Promise<Result<Maybe<Staker>, Error>> {
	const result = await sedaChain.queryContractSmart<StakerFromContract | null>({
		get_staker: {
			public_key: publicKey,
		},
	});

	if (result.isErr) {
		return Result.err(result.error);
	}

	if (result.value === null) {
		return Result.ok(Maybe.nothing());
	}

	return Result.ok(Maybe.just(transformStakerFromContract(result.value, publicKey)));
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
			const result = await sedaChain.queryContractSmart<GetExecutorsResponse>({
				get_executors: {
					limit,
					offset,
				},
			});

			if (result.isErr) {
				return Result.err(result.error);
			}

			stakers.push(...result.value.executors.map((staker) => transformStakerFromContract(staker, staker.public_key)));

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
