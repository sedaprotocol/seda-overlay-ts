import { trySync } from "@seda-protocol/utils";
import { strip0x } from "@sedaprotocol/overlay-ts-common";
import { HDNodeWallet, Mnemonic } from "ethers";
import { Result } from "true-myth";
import * as v from "valibot";
import {
	DEFAULT_IDENTITIES_AMOUNT,
	DEFAULT_MAX_RETRIES,
	DEFAULT_QUEUE_INTERVAL,
	DEFAULT_SLEEP_BETWEEN_FAILED_TX,
	DEFAULT_TRANSACTION_POLL_INTERVAL,
	DEFAULT_ZERO_FEE_GAS,
} from "../constants";

export const SedaChainConfigSchema = v.object({
	rpc: v.string(),
	mnemonic: v.string(),
	chainId: v.string(),
	contract: v.optional(v.string(), "auto"),
	identitiesAmount: v.optional(v.number(), DEFAULT_IDENTITIES_AMOUNT),
	maxRetries: v.optional(v.number(), DEFAULT_MAX_RETRIES),
	sleepBetweenFailedTx: v.optional(v.number(), DEFAULT_SLEEP_BETWEEN_FAILED_TX),
	transactionPollInterval: v.optional(v.number(), DEFAULT_TRANSACTION_POLL_INTERVAL),
	queueInterval: v.optional(v.number(), DEFAULT_QUEUE_INTERVAL),
	zeroFeeGas: v.optional(v.bigint(), DEFAULT_ZERO_FEE_GAS),
});

export interface SedaChainConfig extends v.InferOutput<typeof SedaChainConfigSchema> {
	/// Public key -> Private Key
	identities: Map<string, Buffer>;
	identityIds: string[];
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

	return Result.ok({
		...input,
		identityIds,
		identities,
	});
}
