import * as v from "valibot";
import { DEFAULT_MAX_CONCURRENT_REQUESTS } from "../constants";

export const NodeConfigSchema = v.object({
	workerThreads: v.optional(v.number()),
	maxConcurrentRequests: v.optional(v.number(), DEFAULT_MAX_CONCURRENT_REQUESTS),
});

export type NodeConfig = v.InferOutput<typeof NodeConfigSchema>;
