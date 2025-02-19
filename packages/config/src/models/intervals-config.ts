import * as v from "valibot";
import {
	DEFAULT_ELIGIBILITY_CHECK_INTERVAL,
	DEFAULT_FETCH_TASK_INTERVAL,
	DEFAULT_IDENTITY_CHECK_INTERVAL,
	DEFAULT_STATUS_CHECK_INTERVAL,
} from "../constants";

export const IntervalsConfigSchema = v.object({
	fetchTask: v.optional(v.number(), DEFAULT_FETCH_TASK_INTERVAL),
	identityCheck: v.optional(v.number(), DEFAULT_IDENTITY_CHECK_INTERVAL),
	statusCheck: v.optional(v.number(), DEFAULT_STATUS_CHECK_INTERVAL),
	eligibilityCheck: v.optional(v.number(), DEFAULT_ELIGIBILITY_CHECK_INTERVAL),
});

export type IntervalsConfig = v.InferOutput<typeof IntervalsConfigSchema>;
