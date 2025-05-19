import { isBun } from "./is-bun";

export function getRuntime(): "node" | "bun" {
	if (isBun()) return "bun";
	return "node";
}
