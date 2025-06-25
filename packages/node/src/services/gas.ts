import type { DataRequest } from "../models/data-request";
import type { ExecutionResult } from "../models/execution-result";

// Commit gas estimation coefficients
const COMMIT_COEFFICIENTS = {
	a: 18, // Cost per byte of the data request definition
	b: 280_000, // Fixed base gas for commit transaction execution
	c: 7_500, // RF overhead for additional hash computations (worst-case position)
} as const;

// Reveal gas estimation coefficients
const REVEAL_COEFFICIENTS = {
	a: 60, // Cost per byte of the result value (reveal)
	b: 15, // Cost per byte of stdout and stderr output
	c: 3_000, // Cost per RF for additional hashing computation
} as const;

/**
 * Estimates gas for commit transactions using empiric model
 * Gas = cost of the data request definition + base execution + replication overhead
 */
export function estimateGasForCommit(dataRequest: DataRequest): number {
	const { a, b, c } = COMMIT_COEFFICIENTS;
	const drBytes = calculateDataRequestSize(dataRequest);
	const baseGas = a * drBytes + b;
	const estimatedGas = baseGas + dataRequest.replicationFactor * c;

	return Math.round(estimatedGas);
}

/**
 * Estimates gas for reveal transactions using empiric model
 * Gas = base cost + cost of revealing data + cost of stdout/stderr logs + replication overhead
 */
export function estimateGasForReveal(dataRequest: DataRequest, executionResult: ExecutionResult): number {
	const { a, b, c } = REVEAL_COEFFICIENTS;
	const commitGas = estimateGasForCommit(dataRequest);
	const revealBytes = executionResult.revealBody.reveal.byteLength;
	const stdBytes = calculateStdSize(executionResult);
	const gasRevealBytes = a * revealBytes;
	const gasStd = b * stdBytes;
	const estimatedGas = commitGas + gasRevealBytes + gasStd + dataRequest.replicationFactor * c;

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
