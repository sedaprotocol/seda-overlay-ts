import type { DataRequest as DataRequestFromContract, DataRequestStatus } from "@sedaprotocol/core-contract-schema";

export type DataRequestId = string;

export interface DataRequest {
	id: DataRequestId;
	version: string;
	execProgramId: string;
	execInputs: Buffer;
	execGasLimit: bigint;
	tallyProgramId: string;
	tallyInputs: Buffer;
	tallyGasLimit: bigint;
	replicationFactor: number;
	consensusFilter: Buffer;
	gasPrice: bigint;
	memo: Buffer;
	paybackAddress: Buffer;
	sedaPayload: Buffer;
	height: bigint;
	lastUpdated: Date;
	status: DataRequestStatus;
}

export function transformDataRequestFromContract(request: DataRequestFromContract): DataRequest {
	const commitsLength = Object.keys(request.commits).length;
	return {
		id: request.id,
		version: request.version,
		execProgramId: request.exec_program_id,
		execInputs: Buffer.from(request.exec_inputs, "base64"),
		execGasLimit: BigInt(request.exec_gas_limit),
		tallyProgramId: request.tally_program_id,
		tallyInputs: Buffer.from(request.tally_inputs, "base64"),
		tallyGasLimit: BigInt(request.tally_gas_limit),
		replicationFactor: request.replication_factor,
		consensusFilter: Buffer.from(request.consensus_filter, "base64"),
		gasPrice: BigInt(request.gas_price),
		memo: Buffer.from(request.memo, "base64"),
		paybackAddress: Buffer.from(request.payback_address, "base64"),
		sedaPayload: Buffer.from(request.seda_payload, "base64"),
		height: BigInt(request.height),
		lastUpdated: new Date(),
		status: commitsLength >= request.replication_factor ? "revealing" : "committing",
	};
}

export function isDrInRevealStage(request: DataRequest): boolean {
	return request.status === "revealing";
}

export function isDrStale(request: DataRequest): boolean {
	const now = new Date();
	const timeSinceLastUpdate = now.getTime() - request.lastUpdated.getTime();

	// If no update in 15 seconds, consider stale
	return timeSinceLastUpdate > 15_000;
}
