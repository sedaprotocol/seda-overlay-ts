import { execSync } from "node:child_process";
import { resolve } from "node:path";

export function getEmbeddedSyncExecuteWorkerCode(): string {
	const output = execSync(`bun build ${resolve(import.meta.dirname, "./sync-execute-worker.ts")} --target node`, {
		encoding: "utf-8",
		maxBuffer: 1024 * 1024 * 10,
	});
	return output;
}
