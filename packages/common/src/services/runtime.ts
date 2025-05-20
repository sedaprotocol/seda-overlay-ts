import { isBun } from "./is-bun";

export function getRuntime(): "node" | "bun" | "deno" {
	if (isBun()) return "bun";
	// @ts-ignore
	if (typeof Deno !== "undefined") return "deno";
	return "node";
}
