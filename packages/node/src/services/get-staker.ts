import type { SedaChain } from "@sedaprotocol/overlay-ts-common";
import { Maybe, Result } from "true-myth";

interface StakerFromContract {
	memo?: string;
	tokens_staked: string;
	tokens_pending_withdrawal: string;
}

export interface Staker {
	memo: Maybe<Buffer>;
	tokensStaked: bigint;
	tokensPendingWithdrawal: bigint;
}

function transformStakerFromContract(staker: StakerFromContract): Staker {
	return {
		memo: staker.memo ? Maybe.just(Buffer.from(staker.memo, "base64")) : Maybe.nothing(),
		tokensStaked: BigInt(staker.tokens_staked),
		tokensPendingWithdrawal: BigInt(staker.tokens_pending_withdrawal),
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

	return Result.ok(Maybe.just(transformStakerFromContract(result.value)));
}
