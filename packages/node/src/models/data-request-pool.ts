import { Maybe } from "true-myth";
import type { DataRequest, DataRequestId } from "./data-request";
import type { ExecutionResult } from "./execution-result";

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
	identityId: string;
	status: IdentityDataRequestStatus;
	executionResult: Maybe<ExecutionResult>;
}

type IdentityDataRequestInfo = {
	dataRequest: DataRequest;
	identityInfo: IdentityDataRequest;
};

export class DataRequestPool {
	private items: Map<DataRequest["id"], DataRequest> = new Map();
	private identityDataRequests: Map<string, IdentityDataRequest> = new Map();

	static createIdentityDrKey(drId: DataRequestId, identityId: string): string {
		return `${drId}_${identityId}`;
	}

	insertIdentityDataRequest(
		drId: DataRequestId,
		identityId: string,
		executionResult: Maybe<ExecutionResult>,
		status: IdentityDataRequestStatus,
	) {
		this.identityDataRequests.set(DataRequestPool.createIdentityDrKey(drId, identityId), {
			drId,
			executionResult,
			identityId,
			status,
		});
	}

	deleteIdentityDataRequest(drId: DataRequestId, identityId: string) {
		this.identityDataRequests.delete(DataRequestPool.createIdentityDrKey(drId, identityId));
	}

	allDataRequests() {
		return this.items.values();
	}

	allIdentityDataRequests() {
		return this.identityDataRequests.values();
	}

	insertDataRequest(dataRequest: DataRequest) {
		this.items.set(dataRequest.id, dataRequest);
	}

	deleteDataRequest(drId: string) {
		this.items.delete(drId);

		// Force all instances to be removed, since the dr is not on the chain
		// there is no reason to keep processing it for an identity
		for (const [key, identityDataRequest] of this.identityDataRequests.entries()) {
			if (identityDataRequest.drId === drId) {
				this.identityDataRequests.delete(key);
			}
		}
	}

	hasDataRequest(drId: DataRequestId) {
		return this.items.has(drId);
	}

	getDataRequest(drId: DataRequestId): Maybe<DataRequest> {
		return Maybe.of(this.items.get(drId));
	}

	getIdentityDataRequest(drId: DataRequestId, identityId: string): Maybe<IdentityDataRequestInfo> {
		const key = DataRequestPool.createIdentityDrKey(drId, identityId);
		const identityDataRequest = Maybe.of(this.identityDataRequests.get(key));

		if (identityDataRequest.isNothing) {
			return Maybe.nothing();
		}

		const dataRequest = this.getDataRequest(drId);

		if (dataRequest.isNothing) {
			return Maybe.nothing();
		}

		return Maybe.just({
			dataRequest: dataRequest.value,
			identityInfo: identityDataRequest.value,
		});
	}
}
