import { trySync } from "@seda-protocol/utils";
import { getRuntime, strip0x } from "@sedaprotocol/overlay-ts-common";
import { HDNodeWallet, Mnemonic } from "ethers";
import { Result } from "true-myth";
import { match } from "ts-pattern";
import * as v from "valibot";
import {
	DEFAULT_ACCOUNT_AMOUNTS,
	DEFAULT_ADJUSTMENT_FACTOR,
	DEFAULT_ADJUSTMENT_FACTOR_COSMOS_MESSAGES,
	DEFAULT_DISABLE_TRANSACTION_BLOCK_SEARCH,
	DEFAULT_ENABLE_REWARDS_WITHDRAWAL,
	DEFAULT_GAS,
	DEFAULT_GAS_PRICE,
	DEFAULT_HTTP_REDIRECT_FOLLOW,
	DEFAULT_HTTP_REDIRECT_TTL_MS,
	DEFAULT_IDENTITIES_AMOUNT,
	DEFAULT_MAX_RETRIES,
	DEFAULT_MIN_SEDA_PER_ACCOUNT,
	DEFAULT_QUEUE_INTERVAL,
	DEFAULT_REWARDS_WITHDRAWAL_INTERVAL,
	DEFAULT_REWARDS_WITHDRAWAL_MINIMUM_THRESHOLD,
	DEFAULT_SLEEP_BETWEEN_FAILED_TX,
	DEFAULT_TRANSACTION_BLOCK_SEARCH_THRESHOLD,
	DEFAULT_TRANSACTION_POLL_INTERVAL,
} from "../constants";
import { getAppVersions } from "./app-versions" with { type: "macro" };

export const SedaChainConfigSchema = v.object({
	rpc: v.string(),
	mnemonic: v.string(),
	accountAmounts: v.optional(v.number(), DEFAULT_ACCOUNT_AMOUNTS),
	minSedaPerAccount: v.optional(v.bigint(), DEFAULT_MIN_SEDA_PER_ACCOUNT),
	chainId: v.string(),
	contract: v.optional(v.string(), "auto"),
	identitiesAmount: v.optional(v.number(), DEFAULT_IDENTITIES_AMOUNT),
	maxRetries: v.optional(v.number(), DEFAULT_MAX_RETRIES),
	sleepBetweenFailedTx: v.optional(v.number(), DEFAULT_SLEEP_BETWEEN_FAILED_TX),
	transactionPollInterval: v.optional(v.number(), DEFAULT_TRANSACTION_POLL_INTERVAL),
	queueInterval: v.optional(v.number(), DEFAULT_QUEUE_INTERVAL),
	gasPrice: v.optional(v.string(), DEFAULT_GAS_PRICE),
	gasAdjustmentFactor: v.optional(v.number(), DEFAULT_ADJUSTMENT_FACTOR),
	gasAdjustmentFactorCosmosMessages: v.optional(v.number(), DEFAULT_ADJUSTMENT_FACTOR_COSMOS_MESSAGES),
	gas: v.optional(v.union([v.number(), v.literal("auto")]), DEFAULT_GAS),
	memoSuffix: v.optional(v.string(), ""),
	followHttpRedirects: v.optional(v.boolean(), DEFAULT_HTTP_REDIRECT_FOLLOW),
	httpRedirectTtlMs: v.optional(v.number(), DEFAULT_HTTP_REDIRECT_TTL_MS),
	// The amount of blocks to search for a transaction in the block (Through block indexing). Before switching to an immediate search. (direct getTx call)
	transactionBlockSearchThreshold: v.optional(v.number(), DEFAULT_TRANSACTION_BLOCK_SEARCH_THRESHOLD),
	disableTransactionBlockSearch: v.optional(v.boolean(), DEFAULT_DISABLE_TRANSACTION_BLOCK_SEARCH),
	rewardsWithdrawalInterval: v.optional(v.number(), DEFAULT_REWARDS_WITHDRAWAL_INTERVAL),
	// The minimum amount of rewards that should be available before withdrawing them. (in atto SEDA)
	rewardsWithdrawalMinimumThreshold: v.pipe(
		v.optional(v.string(), DEFAULT_REWARDS_WITHDRAWAL_MINIMUM_THRESHOLD),
		v.transform((input) => BigInt(input)),
	),
	enableRewardsWithdrawal: v.optional(v.boolean(), DEFAULT_ENABLE_REWARDS_WITHDRAWAL),
});

export interface SedaChainConfig extends v.InferOutput<typeof SedaChainConfigSchema> {
	/// Public key -> Private Key
	identities: Map<string, Buffer>;
	identityIds: string[];
	memo: string;
}

export function createSedaChainConfig(
	input: v.InferOutput<typeof SedaChainConfigSchema>,
): Result<SedaChainConfig, Error> {
	const mnemonic = trySync(() => Mnemonic.fromPhrase(input.mnemonic));
	if (mnemonic.isErr) return Result.err(new Error(`Mnemonic is invalid: ${mnemonic.error.message}`));

	const identities = new Map<string, Buffer>();
	const identityIds: string[] = [];

	for (let identityIndex = 0; identityIndex < input.identitiesAmount; identityIndex++) {
		const identityWallet = HDNodeWallet.fromMnemonic(mnemonic.value, `m/44'/83696865'/0'/0/${identityIndex}`);
		const privateKey = strip0x(identityWallet.privateKey);
		const publicKey = strip0x(identityWallet.publicKey);

		identityIds.push(publicKey);
		identities.set(publicKey, Buffer.from(privateKey, "hex"));
	}

	const appVersions = getAppVersions();

	const emoji = match(getRuntime())
		.with("bun", () => "🥟")
		.with("deno", () => "🦕")
		.with("node", () => "🐢")
		.exhaustive();

	return Result.ok({
		...input,
		identityIds,
		identities,
		memo: `Sent from SEDA Overlay ${emoji} ${appVersions.overlay} (vm/${appVersions.vm}) ${input.memoSuffix}`,
	});
}
