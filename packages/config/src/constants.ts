import { resolve } from "node:path";

export const SEDA_CONFIG_PATH = process.env.SEDA_CONFIG_PATH ?? resolve(process.cwd(), "./config.json");
export const DEFAULT_IDENTITIES_AMOUNT = 1;

export const DEFAULT_FETCH_TASK_INTERVAL = 1_000;
export const DEFAULT_IDENTITY_CHECK_INTERVAL = 20 * 60 * 1000; // 20 minutes in milliseconds
export const DEFAULT_SLEEP_BETWEEN_FAILED_TX = 3_000; // 5 seconds in milliseconds
export const DEFAULT_MAX_RETRIES = 3; // Add default retry limit
export const DEFAULT_STATUS_CHECK_INTERVAL = 5_000; // 5 seconds in milliseconds
export const DEFAULT_ELIGIBILITY_CHECK_INTERVAL = 3000; // 3 seconds in milliseconds
export const DEFAULT_MAX_CONCURRENT_REQUESTS = Number.MAX_SAFE_INTEGER;
export const DEFAULT_MAX_GAS_LIMIT = 300_000_000_000_000n; // 300 Tgas (in gas units)
