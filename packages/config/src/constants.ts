import type { AppConfig } from "./models/app-config";
import type { DeepPartial } from "./types";

export const DEFAULT_IDENTITIES_AMOUNT = 1;

export const DEFAULT_FETCH_TASK_INTERVAL = 1_000;
export const DEFAULT_IDENTITY_CHECK_INTERVAL = 20 * 60 * 1000; // 20 minutes in milliseconds
export const DEFAULT_SLEEP_BETWEEN_FAILED_TX = 3_000; // 5 seconds in milliseconds
export const DEFAULT_MAX_RETRIES = 3; // Add default retry limit
export const DEFAULT_STATUS_CHECK_INTERVAL = 5_000; // 5 seconds in milliseconds
export const DEFAULT_ELIGIBILITY_CHECK_INTERVAL = 3000; // 3 seconds in milliseconds
export const DEFAULT_MAX_CONCURRENT_REQUESTS = Number.MAX_SAFE_INTEGER;
export const DEFAULT_MAX_GAS_LIMIT = 300_000_000_000_000n; // 300 Tgas (in gas units)
export const DEFAULT_MAX_VM_RESULT_SIZE_BYTES = 96000; // 96KB
export const DEFAULT_MAX_VM_LOGS_SIZE_BYTES = 32768; // 32KB

export const PLANET_APP_CONFIG: DeepPartial<AppConfig> = {
	sedaChain: {
		rpc: "https://rpc.planet.seda.xyz/",
		chainId: "seda-1-planet",
		mnemonic: "YOUR SEDA MNEMONIC HERE",
	},
};

export const DEVNET_APP_CONFIG: DeepPartial<AppConfig> = {
	sedaChain: {
		rpc: "https://rpc.devnet.seda.xyz/",
		chainId: "seda-1-devnet",
		mnemonic: "YOUR SEDA MNEMONIC HERE",
	},
};

export const TESTNET_APP_CONFIG: DeepPartial<AppConfig> = {
	sedaChain: {
		rpc: "https://rpc.testnet.seda.xyz/",
		chainId: "seda-1-testnet",
		mnemonic: "YOUR SEDA MNEMONIC HERE",
	},
};

export const MAINNET_APP_CONFIG: DeepPartial<AppConfig> = {
	sedaChain: {
		rpc: "https://rpc.seda.xyz",
		chainId: "seda-1",
		mnemonic: "YOUR SEDA MNEMONIC HERE",
	},
};
