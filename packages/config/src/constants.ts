import type { AppConfig } from "./models/app-config";
import type { DeepPartial } from "./types";

type LogLevel = "debug" | "info" | "warn" | "error" | "silly";

const ONE_SEDA = 1_000_000_000_000_000_000n;

export const DEFAULT_IDENTITIES_AMOUNT = 1;
export const DEFAULT_DEBUG = false;
export const DEFAULT_FETCH_TASK_INTERVAL = 1_000;
export const DEFAULT_IDENTITY_CHECK_INTERVAL = 20 * 60 * 1000; // 20 minutes in milliseconds
export const DEFAULT_SLEEP_BETWEEN_FAILED_TX = 3_000; // 3 seconds in milliseconds
export const DEFAULT_MAX_RETRIES = 3; // Add default retry limit
export const DEFAULT_STATUS_CHECK_INTERVAL = 2_500; // 2.5 seconds in milliseconds
export const DEFAULT_ELIGIBILITY_CHECK_INTERVAL = 3000; // 3 seconds in milliseconds
export const DEFAULT_PROCESS_DR_INTERVAL = 2500;
export const DEFAULT_TRANSACTION_POLL_INTERVAL = 2000; // Renamed from CHAIN_POLL_INTERVAL
export const DEFAULT_DR_TASK_INTERVAL = 100; // Add this line
export const DEFAULT_MAX_CONCURRENT_REQUESTS = 20;
export const DEFAULT_MAX_GAS_LIMIT = 300_000_000_000_000n; // 300 Tgas (in gas units)
export const DEFAULT_MAX_VM_LOGS_SIZE_BYTES = 1024; // 1KB
export const DEFAULT_QUEUE_INTERVAL = 200;
export const DEFAULT_BLOCK_LOCALHOST = true;
export const DEFAULT_TERMINATE_AFTER_COMPLETION = false;
export const DEFAULT_LOG_ROTATION_ENABLED = true;
export const DEFAULT_LOG_ROTATION_LEVEL: LogLevel = "debug";
export const DEFAULT_LOG_ROTATION_MAX_FILES = "14d";
export const DEFAULT_LOG_ROTATION_MAX_SIZE = "10m";
export const DEFAULT_HTTP_SERVER_PORT = 3000;
export const DEFAULT_ADJUSTMENT_FACTOR = 1.1;
export const DEFAULT_ADJUSTMENT_FACTOR_COSMOS_MESSAGES = 2;
export const DEFAULT_GAS_PRICE = "10000000000";
export const DEFAULT_GAS = "auto";
export const DEFAULT_TOTAL_HTTP_TIME_LIMIT = 20_000;
export const DEFAULT_MAX_REVEAL_SIZE = 24_000; // 24KB (should be divided by the replication factor)
export const DEFAULT_ACCOUNT_AMOUNTS = 10;
export const DEFAULT_MIN_SEDA_PER_ACCOUNT = ONE_SEDA;
export const DEFAULT_LOG_LEVEL: LogLevel = "info";
export const DEFAULT_FETCH_LIMIT = 20;
export const DEFAULT_OFFLINE_ELIGIBILITY = true;
export const DEFAULT_FETCH_FAILURE_THRESHOLD = 0.2;
export const DEFAULT_FETCH_COUNT_REFRESH_INTERVAL = 300000; // 5 minutes in milliseconds
export const DEFAULT_GAS_ESTIMATIONS_ENABLED = true;
export const DEFAULT_TRANSACTION_BLOCK_SEARCH_THRESHOLD = 2;
export const DEFAULT_HTTP_REDIRECT_FOLLOW = true;
export const DEFAULT_HTTP_REDIRECT_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const DEFAULT_DISABLE_TRANSACTION_BLOCK_SEARCH = true;
export const DEFAULT_REWARDS_WITHDRAWAL_INTERVAL = 1000 * 60 * 60 * 24; // 1 day in milliseconds
export const DEFAULT_REWARDS_WITHDRAWAL_MINIMUM_THRESHOLD = ONE_SEDA.toString();
export const DEFAULT_ENABLE_REWARDS_WITHDRAWAL = false;

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
		rpc: "https://overlay-rpc.seda.xyz",
		chainId: "seda-1",
		mnemonic: "YOUR SEDA MNEMONIC HERE",
	},
};
