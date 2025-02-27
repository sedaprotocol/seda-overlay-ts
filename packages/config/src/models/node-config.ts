import * as v from "valibot";
import { DEFAULT_MAX_CONCURRENT_REQUESTS, DEFAULT_MAX_GAS_LIMIT } from "../constants";

export const NodeConfigSchema = v.object({
	workerThreads: v.optional(v.number()),
	maxConcurrentRequests: v.optional(v.number(), DEFAULT_MAX_CONCURRENT_REQUESTS),
	maxGasLimit: v.optional(v.bigint(), DEFAULT_MAX_GAS_LIMIT),
});

export type NodeConfig = v.InferOutput<typeof NodeConfigSchema>;
