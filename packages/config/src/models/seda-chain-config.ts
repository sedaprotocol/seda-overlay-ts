import { strip0x } from "@sedaprotocol/overlay-ts-common";
import { HDNodeWallet, Mnemonic } from "ethers";
import * as v from "valibot";
import { DEFAULT_IDENTITIES_AMOUNT, DEFAULT_MAX_RETRIES, DEFAULT_SLEEP_BETWEEN_FAILED_TX } from "../constants";

export const SedaChainConfigSchema = v.object({
	rpc: v.string(),
	mnemonic: v.string(),
	chainId: v.string(),
	contract: v.optional(v.string(), "auto"),
	identitiesAmount: v.optional(v.number(), DEFAULT_IDENTITIES_AMOUNT),
	maxRetries: v.optional(v.number(), DEFAULT_MAX_RETRIES),
	sleepBetweenFailedTx: v.optional(v.number(), DEFAULT_SLEEP_BETWEEN_FAILED_TX),
});

export interface SedaChainConfig extends v.InferOutput<typeof SedaChainConfigSchema> {
	/// Public key -> Private Key
	identities: Map<string, Buffer>;
}

export function createSedaChainConfig(input: v.InferOutput<typeof SedaChainConfigSchema>): SedaChainConfig {
	const mnemonic = Mnemonic.fromPhrase(input.mnemonic);
	const identities = new Map<string, Buffer>();

	for (let identity_index = 0; identity_index < input.identitiesAmount; identity_index++) {
		const identityWallet = HDNodeWallet.fromMnemonic(mnemonic, `m/44'/83696865'/0'/0/${identity_index}`);
		const privateKey = strip0x(identityWallet.privateKey);
		const publicKey = strip0x(identityWallet.publicKey);

		identities.set(publicKey, Buffer.from(privateKey, "hex"));
	}

	return {
		...input,
		identities,
	};
}
