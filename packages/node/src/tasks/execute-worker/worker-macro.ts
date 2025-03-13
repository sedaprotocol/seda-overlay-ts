import { execSync } from "node:child_process";
import { resolve } from "node:path";

export function getEmbeddedVmWorkerCode(): string {
	const path = resolve(import.meta.dirname, "./execute-worker.ts");

	const output = execSync(`bun build ${path} --target node`, {
		encoding: "utf-8",
		maxBuffer: 1024 * 1024 * 10, // 10MB buffer
	});
	return output;
}

export function getEmbeddedCompileWorkerCode(): string {
	const output = execSync(`bun build ${resolve(import.meta.dirname, "./compile-worker.ts")} --target node`, {
		encoding: "utf-8",
		maxBuffer: 1024 * 1024 * 10,
	});
	return output;
}
