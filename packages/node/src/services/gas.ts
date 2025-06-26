import type { RevealBody } from "@sedaprotocol/core-contract-schema";
import type { DataRequest } from "../models/data-request";
import type { ExecutionResult } from "../models/execution-result";

// Commit gas estimation coefficients
const COMMIT_COEFFICIENTS = {
	dataCost: 18, // Cost per byte of the data request definition
	baseCost: 280_000, // Fixed base gas for commit transaction execution
	rfOverhead: 7_500, // RF overhead for additional hash computations (worst-case position)
} as const;

// Reveal gas estimation coefficients
const REVEAL_COEFFICIENTS = {
	dataCost: 60, // Cost per byte of the result value (reveal)
	outputCost: 15, // Cost per byte of stdout and stderr output
	rfOverhead: 3_000, // Cost per RF for additional hashing computation
} as const;

/**
 * Estimates gas for commit transactions using empiric model
 * Gas = cost of the data request definition + base execution + replication overhead
 */
export function estimateGasForCommit(dataRequest: DataRequest): number {
	const { dataCost, baseCost, rfOverhead } = COMMIT_COEFFICIENTS;
	const drBytes = calculateDataRequestSize(dataRequest);
	const baseGas = dataCost * drBytes + baseCost;
	const estimatedGas = baseGas + dataRequest.replicationFactor * rfOverhead;

	return Math.round(estimatedGas);
}

/**
 * Estimates gas for reveal transactions using empiric model
 * Gas = base cost + cost of revealing data + cost of stdout/stderr logs + replication overhead
 */
export function estimateGasForReveal(dataRequest: DataRequest, executionResult: ExecutionResult): number {
	const { dataCost, outputCost, rfOverhead } = REVEAL_COEFFICIENTS;
	const commitGas = estimateGasForCommit(dataRequest);
	const revealBytes = calculateRevealBytes(executionResult.revealBody);
	const stdBytes = calculateStdSize(executionResult);
	const gasRevealBytes = dataCost * revealBytes;
	const gasStd = outputCost * stdBytes;
	const estimatedGas = commitGas + gasRevealBytes + gasStd + dataRequest.replicationFactor * rfOverhead;

	return Math.round(estimatedGas);
}

/**
 * Calculates the size of the data request definition in bytes
 * Only considers fields that are stored in the contract (DataRequestBase)
 */
function calculateDataRequestSize(dataRequest: DataRequest): number {
	const contractDataRequest = {
		id: dataRequest.id,
		version: dataRequest.version,
		exec_program_id: dataRequest.execProgramId,
		exec_inputs: dataRequest.execInputs, // Bytes (Uint8Array)
		exec_gas_limit: Number(dataRequest.execGasLimit), // u64 -> number
		tally_program_id: dataRequest.tallyProgramId, // String
		tally_inputs: dataRequest.tallyInputs, // Bytes (Uint8Array)
		tally_gas_limit: Number(dataRequest.tallyGasLimit), // u64 -> number
		replication_factor: dataRequest.replicationFactor, // u16 -> number
		consensus_filter: dataRequest.consensusFilter, // Bytes (Uint8Array)
		gas_price: dataRequest.gasPrice.toString(), // U128 -> string
		memo: dataRequest.memo, // Bytes (Uint8Array)
		payback_address: dataRequest.paybackAddress, // Bytes (Uint8Array)
		seda_payload: dataRequest.sedaPayload, // Bytes (Uint8Array)
		height: Number(dataRequest.height), // u64 -> number
	};

	const serialized = JSON.stringify(contractDataRequest);
	return Buffer.byteLength(serialized, "utf8");
}

/**
 * Calculates the size of stdout and stderr output in bytes
 */
function calculateStdSize(executionResult: ExecutionResult): number {
	const stdoutString = executionResult.stdout.join("");
	const stderrString = executionResult.stderr.join("");

	return Buffer.byteLength(stdoutString, "utf8") + Buffer.byteLength(stderrString, "utf8");
}

/**
 * Calculates the size of the reveal body in bytes considering only revealed result and proxy public keys
 */
function calculateRevealBytes(revealBody: RevealBody): number {
	return revealBody.reveal.byteLength + revealBody.proxy_public_keys.reduce((sum, key) => sum + key.length, 0);
}
