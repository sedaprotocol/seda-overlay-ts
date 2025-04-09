import type { GetDataRequestResponse, GetDataRequestsByStatusResponse } from "@sedaprotocol/core-contract-schema";
import type { SedaChain } from "@sedaprotocol/overlay-ts-common";
import { Maybe, Result } from "true-myth";
import { transformDataRequestFromContract } from "../models/data-request";
import type { DataRequest } from "../models/data-request";
import { Cache } from "../services/cache";

interface DataRequestsResponse {
	dataRequests: DataRequest[];
	total: number;
	isPaused: boolean;
}

// TODO: Check if lastSeenIndex is needed
export async function getDataRequests(
	sedaChain: SedaChain,
	limit: number,
): Promise<Result<DataRequestsResponse, Error>> {
	const result = await sedaChain.queryContractSmart<GetDataRequestsByStatusResponse>({
		get_data_requests_by_status: {
			status: "committing",
			limit,
		},
	});

	if (result.isErr) {
		return Result.err(result.error);
	}

	const dataRequests = result.value.data_requests.map((request) => transformDataRequestFromContract(request));
	return Result.ok({
		dataRequests,
		total: result.value.total,
		isPaused: result.value.is_paused,
	});
}

// TODO: Make configurable
// Create a cache instance for data requests
const dataRequestCache = new Cache<DataRequest>(3_000);

export async function getDataRequest(drId: string, sedaChain: SedaChain): Promise<Result<Maybe<DataRequest>, Error>> {
	const cachedValue = dataRequestCache.get(drId);

	if (cachedValue.isJust) {
		return Result.ok(cachedValue);
	}

	const result = await sedaChain.queryContractSmart<GetDataRequestResponse>({
		get_data_request: {
			dr_id: drId,
		},
	});

	if (result.isErr) {
		if (result.error.message.includes("not found")) {
			return Result.ok(Maybe.nothing());
		}

		return Result.err(result.error);
	}

	const dr = Maybe.of(result.value).map((v) => transformDataRequestFromContract(v));
	if (dr.isNothing) return Result.ok(Maybe.nothing());

	dataRequestCache.set(drId, dr.value);
	return Result.ok(dr);
}
