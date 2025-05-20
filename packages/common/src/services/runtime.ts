import { isBun } from "./is-bun";

export function getRuntime(): "node" | "bun" | "deno" {
	if (isBun()) return "bun";
	if (typeof Deno !== "undefined") return "deno";
	return "node";
}
