import type { DataRequestResponse } from "@seda-protocol/proto-messages/libs/proto-messages/gen/sedachain/core/v1/query";
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
	postedGasPrice: bigint;
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
		postedGasPrice: BigInt(request.posted_gas_price),
		memo: Buffer.from(request.memo, "base64"),
		paybackAddress: Buffer.from(request.payback_address, "base64"),
		sedaPayload: Buffer.from(request.seda_payload, "base64"),
		height: BigInt(request.height),
		lastUpdated: new Date(),
		status: commitsLength >= request.replication_factor ? "revealing" : "committing",
	};
}

export function transformDataRequestFromModule(response: DataRequestResponse): DataRequest {
	if (!response.dataRequest) {
		throw new Error("Data request not found in response");
	}
	const commitsLength = Object.keys(response.commits).length;
	return {
		id: response.dataRequest.iD,
		version: response.dataRequest.version,
		execProgramId: response.dataRequest.execProgramID,
		execInputs: Buffer.from(response.dataRequest.execInputs),
		execGasLimit: BigInt(response.dataRequest.execGasLimit),
		tallyProgramId: response.dataRequest.tallyProgramID,
		tallyInputs: Buffer.from(response.dataRequest.tallyInputs),
		tallyGasLimit: BigInt(response.dataRequest.tallyGasLimit),
		replicationFactor: response.dataRequest.replicationFactor,
		consensusFilter: Buffer.from(response.dataRequest.consensusFilter),
		gasPrice: BigInt(response.dataRequest.gasPrice),
		postedGasPrice: BigInt(response.dataRequest.postedGasPrice),
		memo: Buffer.from(response.dataRequest.memo),
		paybackAddress: Buffer.from(response.dataRequest.paybackAddress),
		sedaPayload: Buffer.from(response.dataRequest.sEDAPayload),
		height: BigInt(response.dataRequest.postedHeight),
		lastUpdated: new Date(),
		status: commitsLength >= response.dataRequest.replicationFactor ? "revealing" : "committing",
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
