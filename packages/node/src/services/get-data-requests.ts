import type { GetDataRequestResponse, GetDataRequestsByStatusResponse } from "@sedaprotocol/core-contract-schema";
import type { SedaChain } from "@sedaprotocol/overlay-ts-common";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Maybe, Result } from "true-myth";
import { transformDataRequestFromContract } from "../models/data-request";
import type { DataRequest } from "../models/data-request";
import { Cache } from "../services/cache";

interface DataRequestsResponse {
	dataRequests: DataRequest[];
	total: number;
	isPaused: boolean;
	hasMore: boolean;
}

type LastSeenIndex = GetDataRequestsByStatusResponse["last_seen_index"];
let lastSeenIndex: LastSeenIndex = null;

export async function getDataRequests(
	sedaChain: SedaChain,
	limit: number,
): Promise<Result<DataRequestsResponse, Error>> {
	const result = await sedaChain.queryContractSmart<GetDataRequestsByStatusResponse>({
		get_data_requests_by_status: {
			status: "committing",
			limit,
			last_seen_index: lastSeenIndex,
		},
	});

	if (result.isErr) {
		return Result.err(result.error);
	}

	lastSeenIndex = result.value.last_seen_index;

	const dataRequests = result.value.data_requests.map((request) => transformDataRequestFromContract(request));

	return Result.ok({
		dataRequests,
		total: result.value.total,
		isPaused: result.value.is_paused,
		hasMore: Maybe.of(lastSeenIndex).isJust,
	});
}

// TODO: Make configurable
// Create a cache instance for data requests
const dataRequestCache = new Cache<DataRequest>(3_000);

export async function getDataRequest(drId: string, sedaChain: SedaChain): Promise<Result<Maybe<DataRequest>, Error>> {
	const cachedValue = dataRequestCache.get(drId);

	logger.trace("Getting data request", {
		id: drId,
	});

	if (cachedValue.isJust) {
		logger.trace("Data request data fetched from cache", {
			id: drId,
		});

		return Result.ok(cachedValue);
	}

	logger.trace("Data request data not found in cache, fetching from chain", {
		id: drId,
	});

	const result = await sedaChain.queryContractSmart<GetDataRequestResponse>({
		get_data_request: {
			dr_id: drId,
		},
	});

	logger.trace("Data request data fetched from chain", {
		id: drId,
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
