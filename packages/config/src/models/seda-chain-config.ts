import { trySync } from "@seda-protocol/utils";
import { getRuntime, strip0x } from "@sedaprotocol/overlay-ts-common";
import { HDNodeWallet, Mnemonic } from "ethers";
import { Result } from "true-myth";
import { match } from "ts-pattern";
import * as v from "valibot";
import {
	DEFAULT_ACCOUNT_AMOUNTS,
	DEFAULT_ADJUSTMENT_FACTOR,
	DEFAULT_GAS,
	DEFAULT_GAS_PRICE,
	DEFAULT_IDENTITIES_AMOUNT,
	DEFAULT_MAX_RETRIES,
	DEFAULT_MIN_SEDA_PER_ACCOUNT,
	DEFAULT_QUEUE_INTERVAL,
	DEFAULT_SLEEP_BETWEEN_FAILED_TX,
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
	gas: v.optional(v.union([v.number(), v.literal("auto")]), DEFAULT_GAS),
	memoSuffix: v.optional(v.string(), ""),
	grpcEndpoint: v.optional(v.string()),
	grpcOptions: v.optional(v.object({
		maxConcurrentStreams: v.optional(v.number()),
		keepAlive: v.optional(v.boolean()),
		poolSize: v.optional(v.number()),
		enableStreaming: v.optional(v.boolean()),
		timeout: v.optional(v.number()),
	})),
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
