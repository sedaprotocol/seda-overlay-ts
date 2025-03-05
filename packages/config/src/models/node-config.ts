import * as v from "valibot";
import {
	DEFAULT_MAX_CONCURRENT_REQUESTS,
	DEFAULT_MAX_GAS_LIMIT,
	DEFAULT_MAX_VM_LOGS_SIZE_BYTES,
	DEFAULT_MAX_VM_RESULT_SIZE_BYTES,
	DEFAULT_PROCESS_DR_INTERVAL,
	DEFAULT_BLOCK_LOCALHOST,
} from "../constants";

export const NodeConfigSchema = v.object({
	workerThreads: v.optional(v.number()),
	maxConcurrentRequests: v.optional(v.number(), DEFAULT_MAX_CONCURRENT_REQUESTS),
	maxGasLimit: v.optional(v.bigint(), DEFAULT_MAX_GAS_LIMIT),
	maxVmResultSizeBytes: v.optional(v.number(), DEFAULT_MAX_VM_RESULT_SIZE_BYTES),
	maxVmLogsSizeBytes: v.optional(v.number(), DEFAULT_MAX_VM_LOGS_SIZE_BYTES),
	processDrInterval: v.optional(v.number(), DEFAULT_PROCESS_DR_INTERVAL),
	blockLocalhost: v.optional(v.boolean(), DEFAULT_BLOCK_LOCALHOST),
});

export type NodeConfig = v.InferOutput<typeof NodeConfigSchema>;
