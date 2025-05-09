import * as v from "valibot";
import {
	DEFAULT_BLOCK_LOCALHOST,
	DEFAULT_FORCE_SYNC_VM,
	DEFAULT_LOG_ROTATION_ENABLED,
	DEFAULT_LOG_ROTATION_LEVEL,
	DEFAULT_LOG_ROTATION_MAX_FILES,
	DEFAULT_LOG_ROTATION_MAX_SIZE,
	DEFAULT_MAX_CONCURRENT_REQUESTS,
	DEFAULT_MAX_GAS_LIMIT,
	DEFAULT_MAX_VM_LOGS_SIZE_BYTES,
	DEFAULT_MAX_VM_RESULT_SIZE_BYTES,
	DEFAULT_PROCESS_DR_INTERVAL,
	DEFAULT_TERMINATE_AFTER_COMPLETION,
} from "../constants";

export const NodeConfigSchema = v.object({
	forceSyncVm: v.optional(v.boolean(), DEFAULT_FORCE_SYNC_VM),
	threadAmount: v.optional(v.number()),
	terminateAfterCompletion: v.optional(v.boolean(), DEFAULT_TERMINATE_AFTER_COMPLETION),
	maxConcurrentRequests: v.optional(v.number(), DEFAULT_MAX_CONCURRENT_REQUESTS),
	maxGasLimit: v.optional(v.bigint(), DEFAULT_MAX_GAS_LIMIT),
	maxVmResultSizeBytes: v.optional(v.number(), DEFAULT_MAX_VM_RESULT_SIZE_BYTES),
	maxVmLogsSizeBytes: v.optional(v.number(), DEFAULT_MAX_VM_LOGS_SIZE_BYTES),
	processDrInterval: v.optional(v.number(), DEFAULT_PROCESS_DR_INTERVAL),
	blockLocalhost: v.optional(v.boolean(), DEFAULT_BLOCK_LOCALHOST),
	logRotationEnabled: v.optional(v.boolean(), DEFAULT_LOG_ROTATION_ENABLED),
	logRotationLevel: v.optional(v.string(), DEFAULT_LOG_ROTATION_LEVEL),
	logRotationMaxFiles: v.optional(v.string(), DEFAULT_LOG_ROTATION_MAX_FILES),
	logRotationMaxSize: v.optional(v.string(), DEFAULT_LOG_ROTATION_MAX_SIZE),
});

export type NodeConfig = v.InferOutput<typeof NodeConfigSchema>;
