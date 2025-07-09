import { stringToPath } from "@cosmjs/crypto";
import { DirectSecp256k1HdWallet, type OfflineSigner } from "@cosmjs/proto-signing";
import { tryAsync } from "@seda-protocol/utils";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { AUTO_CORE_CONTRACT_VALUE } from "@sedaprotocol/overlay-ts-node/src/constants";
import { Result } from "true-myth";
import { createWasmQueryClient } from "./query-client";

const BECH32_ADDRESS_PREFIX = "seda";

export interface ISigner {
	getEndpoint: () => string;
	getSigner: () => OfflineSigner;
	getAddress: () => string;
	getCoreContractAddress: () => Promise<string>;
}

export class Signer implements ISigner {
	private constructor(
		private endpoint: string,
		private signer: DirectSecp256k1HdWallet,
		private address: string,
		private coreContractAddress: string,
	) {}

	/**
	 * Attempts to initialise a signer by parsing environment variables for config that is not
	 * provided directly.
	 *
	 * @throws Error when initialising wallet or deriving address fails.
	 */
	static async fromConfig(config: AppConfig, index = 0): Promise<Result<Signer, Error>> {
		const wallet = await DirectSecp256k1HdWallet.fromMnemonic(config.sedaChain.mnemonic, {
			prefix: BECH32_ADDRESS_PREFIX,
			hdPaths: [stringToPath(`m/44'/118'/0'/0/${index}`)],
		});

		const contract = await resolveCoreContractAddress(config);

		if (contract.isErr) {
			return Result.err(contract.error);
		}

		const accounts = await wallet.getAccounts();
		if (accounts.length === 0) {
			return Result.err(new Error("Address for given mnemonic does not exist"));
		}

		const address = accounts[0].address;

		return Result.ok(new Signer(config.sedaChain.rpc, wallet, address, contract.value));
	}

	getSigner() {
		return this.signer;
	}

	getAddress() {
		return this.address;
	}

	getEndpoint() {
		return this.endpoint;
	}

	async getCoreContractAddress() {
		return this.coreContractAddress;
	}
}

async function resolveCoreContractAddress(config: AppConfig): Promise<Result<string, Error>> {
	if (config.sedaChain.contract !== AUTO_CORE_CONTRACT_VALUE) {
		return Result.ok(config.sedaChain.contract);
	}

	const queryClient = await tryAsync(createWasmQueryClient(config.sedaChain.rpc));

	if (queryClient.isErr) {
		return Result.err(new Error(`Could not create query client: ${queryClient.error}`));
	}

	const response = await tryAsync(async () => queryClient.value.CoreContractRegistry({}));

	if (response.isErr) {
		return Result.err(new Error(`Could not fetch core contract from chain: ${response.error.message}`));
	}

	return Result.ok(response.value.address);
}
