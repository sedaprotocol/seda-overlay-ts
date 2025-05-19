import * as v from "valibot";
import { DEFAULT_HTTP_SERVER_PORT } from "../constants";

export const HttpServerConfigSchema = v.object({
	port: v.optional(v.number(), DEFAULT_HTTP_SERVER_PORT),
	enableAutoPortDiscovery: v.optional(v.boolean(), false),
});

export type HttpServerConfig = v.InferOutput<typeof HttpServerConfigSchema>;
