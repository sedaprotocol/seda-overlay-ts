import type { DataRequestStatus } from "@sedaprotocol/core-contract-schema";
import { Maybe } from "true-myth";
import type { DataRequest, DataRequestId } from "./data-request";
import type { ExecutionResult } from "./execution-result";
import { SizedSet } from "@sedaprotocol/overlay-ts-common";

export enum IdentityDataRequestStatus {
	// We are picked to execute the Data Request
	EligibleForExecution = "ELIGIBLE_FOR_EXECUTION",

	// The node has executed the Data Request and is ready to be committed
	Executed = "EXECUTED",

	// The node has committed the answer
	Committed = "COMMITTED",

	// Data Request is ready to be revealed (The minimum amount of commits is reached)
	ReadyToBeRevealed = "READY_TO_BE_REVEALED",

	// The node has revealed the answer,
	Revealed = "REVEALED",

	// The Data Request has been resolved on the SEDA chain, and can be safely removed
	Resolved = "RESOLVED",

	// Node could not recover from an error while executing the data request (commit, reveal, or execute)
	Failed = "FAILED",
}

interface IdentityDataRequest {
	drId: string;
	height: bigint;
	identityId: string;
	/**
	 * The height at which the identity was eligible for execution. It can be greater
	 * than the height at which it became eligible. We need this for data-proxy calls
	 * so they can know if their RPC is up to date.
	 */
	eligibilityHeight: bigint;
	status: IdentityDataRequestStatus;
	executionResult: Maybe<ExecutionResult>;
}

type IdentityDataRequestInfo = {
	dataRequest: DataRequest;
	identityInfo: IdentityDataRequest;
};

type DataRequestKey = `${DataRequest["id"]}_${DataRequest["height"]}`;
type IdentityDataRequestKey = `${DataRequestKey}_${string}`;

export class DataRequestPool {
	private items: Map<DataRequestKey, DataRequest> = new Map();
	private identityDataRequests: Map<IdentityDataRequestKey, IdentityDataRequest> = new Map();
	private resolvedDataRequests: SizedSet<DataRequestKey> = new SizedSet(1000);
	private identityResolvedDataRequests: Set<IdentityDataRequestKey> = new Set();

	static createIdentityDrKey(drId: DataRequestId, height: bigint, identityId: string): IdentityDataRequestKey {
		return `${drId}_${height}_${identityId}`;
	}

	get size() {
		return this.items.size;
	}

	get identitySize() {
		return this.identityDataRequests.size;
	}

	isDrResolved(drId: DataRequestId, height: bigint) {
		return this.resolvedDataRequests.has(`${drId}_${height}`);
	}

	isIdentityDrResolved(drId: DataRequestId, height: bigint, identityId: string) {
		return this.identityResolvedDataRequests.has(DataRequestPool.createIdentityDrKey(drId, height, identityId));
	}

	insertIdentityDataRequest(
		drId: DataRequestId,
		height: bigint,
		identityId: string,
		eligibilityHeight: bigint,
		executionResult: Maybe<ExecutionResult>,
		status: IdentityDataRequestStatus,
	) {
		this.identityDataRequests.set(DataRequestPool.createIdentityDrKey(drId, height, identityId), {
			drId,
			height,
			executionResult,
			identityId,
			status,
			eligibilityHeight,
		});
	}

	deleteIdentityDataRequest(drId: DataRequestId, height: bigint, identityId: string) {
		this.identityResolvedDataRequests.add(DataRequestPool.createIdentityDrKey(drId, height, identityId));
		this.identityDataRequests.delete(DataRequestPool.createIdentityDrKey(drId, height, identityId));
	}

	allDataRequests() {
		return this.items.values();
	}

	allIdentityDataRequests() {
		return this.identityDataRequests.values();
	}

	/**
	 * Check if the data request is being processed by any identity
	 * @param drId - The data request id
	 * @returns true if the data request is being processed by any identity, false otherwise
	 */
	isDrBeingProcessed(drId: DataRequestId, height: bigint): boolean {
		return this.identityDataRequests.values().some((identityDataRequest) => identityDataRequest.drId === drId && identityDataRequest.height === height);
	}

	updateDataRequestStatus(drId: DataRequestId, height: bigint, status: DataRequestStatus) {
		const dataRequest = this.getDataRequest(drId, height);
		if (dataRequest.isNothing) {
			return;
		}
		dataRequest.value.status = status;
	}

	insertDataRequest(dataRequest: DataRequest) {
		this.items.set(`${dataRequest.id}_${dataRequest.height}`, dataRequest);
	}

	deleteDataRequest(drId: DataRequestId, height: bigint) {
		this.items.delete(`${drId}_${height}`);

		// Force all instances to be removed, since the dr is not on the chain
		// there is no reason to keep processing it for an identity
		for (const [key, identityDataRequest] of this.identityDataRequests.entries()) {
			if (identityDataRequest.drId === drId && identityDataRequest.height === height) {
				this.identityResolvedDataRequests.add(key);
				this.identityDataRequests.delete(key);
			}
		}

		this.resolvedDataRequests.add(`${drId}_${height}`);
	}

	hasDataRequest(drId: DataRequestId, height: bigint) {
		return this.items.has(`${drId}_${height}`);
	}

	getDataRequest(drId: DataRequestId, height: bigint): Maybe<DataRequest> {
		return Maybe.of(this.items.get(`${drId}_${height}`));
	}

	getIdentityDataRequest(drId: DataRequestId, height: bigint, identityId: string): Maybe<IdentityDataRequestInfo> {
		const key = DataRequestPool.createIdentityDrKey(drId, height, identityId);
		const identityDataRequest = Maybe.of(this.identityDataRequests.get(key));

		if (identityDataRequest.isNothing) {
			return Maybe.nothing();
		}

		const dataRequest = this.getDataRequest(drId, height);

		if (dataRequest.isNothing) {
			return Maybe.nothing();
		}

		return Maybe.just({
			dataRequest: dataRequest.value,
			identityInfo: identityDataRequest.value,
		});
	}
}
