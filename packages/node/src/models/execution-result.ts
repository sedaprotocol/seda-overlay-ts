import type { RevealBody } from "@sedaprotocol/core-contract-schema";

export interface ExecutionResult {
	stdout: string[];
	stderr: string[];
	revealBody: RevealBody;
}
