import * as v from "valibot";
import {
	DEFAULT_BLOCK_LOCALHOST,
	DEFAULT_DEBUG,
	DEFAULT_FETCH_LIMIT,
	DEFAULT_FORCE_SYNC_VM,
	DEFAULT_LOG_LEVEL,
	DEFAULT_LOG_ROTATION_ENABLED,
	DEFAULT_LOG_ROTATION_LEVEL,
	DEFAULT_LOG_ROTATION_MAX_FILES,
	DEFAULT_LOG_ROTATION_MAX_SIZE,
	DEFAULT_MAX_CONCURRENT_REQUESTS,
	DEFAULT_MAX_GAS_LIMIT,
	DEFAULT_MAX_VM_LOGS_SIZE_BYTES,
	DEFAULT_OFFLINE_ELIGIBILITY,
	DEFAULT_PROCESS_DR_INTERVAL,
	DEFAULT_TERMINATE_AFTER_COMPLETION,
	DEFAULT_TOTAL_HTTP_TIME_LIMIT,
} from "../constants";

export const NodeConfigSchema = v.object({
	debug: v.optional(v.boolean(), DEFAULT_DEBUG),
	forceSyncVm: v.optional(v.boolean(), DEFAULT_FORCE_SYNC_VM),
	threadAmount: v.optional(v.number()),
	terminateAfterCompletion: v.optional(v.boolean(), DEFAULT_TERMINATE_AFTER_COMPLETION),
	maxConcurrentRequests: v.optional(v.number(), DEFAULT_MAX_CONCURRENT_REQUESTS),
	maxGasLimit: v.optional(v.bigint(), DEFAULT_MAX_GAS_LIMIT),
	maxVmLogsSizeBytes: v.optional(v.number(), DEFAULT_MAX_VM_LOGS_SIZE_BYTES),
	processDrInterval: v.optional(v.number(), DEFAULT_PROCESS_DR_INTERVAL),
	blockLocalhost: v.optional(v.boolean(), DEFAULT_BLOCK_LOCALHOST),
	logLevel: v.optional(v.string(), DEFAULT_LOG_LEVEL),
	logRotationEnabled: v.optional(v.boolean(), DEFAULT_LOG_ROTATION_ENABLED),
	logRotationLevel: v.optional(v.string(), DEFAULT_LOG_ROTATION_LEVEL),
	logRotationMaxFiles: v.optional(v.string(), DEFAULT_LOG_ROTATION_MAX_FILES),
	logRotationMaxSize: v.optional(v.string(), DEFAULT_LOG_ROTATION_MAX_SIZE),
	totalHttpTimeLimit: v.optional(v.number(), DEFAULT_TOTAL_HTTP_TIME_LIMIT),
	drFetchLimit: v.optional(v.number(), DEFAULT_FETCH_LIMIT),
	offlineEligibility: v.optional(v.boolean(), DEFAULT_OFFLINE_ELIGIBILITY),
});

export type NodeConfig = v.InferOutput<typeof NodeConfigSchema>;
