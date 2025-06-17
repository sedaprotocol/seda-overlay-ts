import type { GetExecutorsResponse, Staker as StakerFromContract } from "@sedaprotocol/core-contract-schema";
import type { SedaChain } from "@sedaprotocol/overlay-ts-common";
import { Maybe, Result } from "true-myth";
import { Cache } from "./cache";

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

const STAKERS_CACHE_TTL = 1000 * 60 * 60 * 1; // 1 hour
const stakersCache = new Cache<Staker[]>(STAKERS_CACHE_TTL);
const DEFAULT_LIMIT = 100;

export async function getStakers(sedaChain: SedaChain): Promise<Result<Staker[], Error>> {
	return stakersCache.getOrFetch("stakers", async () => {
		const result = await sedaChain.queryContractSmart<GetExecutorsResponse>({
			get_executors: {
				limit: DEFAULT_LIMIT,
				offset: 0,
			},
		});

		console.log("result", result);

		if (result.isErr) {
			return Result.err(result.error);
		}

		return Result.ok(result.value.executors.map((staker) => transformStakerFromContract(staker, staker.public_key)));
	});
}
