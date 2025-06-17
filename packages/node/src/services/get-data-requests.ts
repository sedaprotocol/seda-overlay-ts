import type {
	GetDataRequestResponse,
	GetDataRequestsByStatusResponse,
	QueryMsg,
} from "@sedaprotocol/core-contract-schema";
import type { SedaChain } from "@sedaprotocol/overlay-ts-common";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { JSONStringify } from "json-with-bigint";
import { Maybe, Result } from "true-myth";
import { transformDataRequestFromContract } from "../models/data-request";
import type { DataRequest } from "../models/data-request";
import { Cache } from "../services/cache";
import { DebouncedPromise } from "./debounce-promise";

interface DataRequestsResponse {
	dataRequests: DataRequest[];
	total: number;
	isPaused: boolean;
	hasMore: boolean;
	lastSeenIndex: LastSeenIndex;
}

type LastSeenIndex = GetDataRequestsByStatusResponse["last_seen_index"];
let lastSeenIndex: LastSeenIndex = null;

export async function getDataRequests(
	sedaChain: SedaChain,
	limit: number,
): Promise<Result<DataRequestsResponse, Error>> {
	const message: QueryMsg = {
		get_data_requests_by_status: {
			status: "committing",
			limit,
			last_seen_index: lastSeenIndex ?? null,
		},
	};

	const result = await sedaChain.queryContractSmartBigInt<GetDataRequestsByStatusResponse>(message);

	if (result.isErr) {
		return Result.err(new Error(`Failed to fetch data requests: ${JSONStringify(message)} ${result.error.message}`));
	}

	lastSeenIndex = result.value.last_seen_index;
	const dataRequests = result.value.data_requests.map((request) => transformDataRequestFromContract(request));

	for (const dr of dataRequests) {
		dataRequestCache.set(dr.id, dr);
	}

	return Result.ok({
		dataRequests,
		total: result.value.total,
		isPaused: result.value.is_paused,
		hasMore: Maybe.of(lastSeenIndex).isJust,
		lastSeenIndex,
	});
}

// TODO: Make configurable
// Create a cache instance for data requests
const dataRequestCache = new Cache<DataRequest>(3_000);

// Debounce promises for data requests, making sure only one request goes through for each drId
const dataRequestDebouncedPromise = new DebouncedPromise<Result<Maybe<DataRequest>, Error>>();

export async function getDataRequest(drId: string, sedaChain: SedaChain): Promise<Result<Maybe<DataRequest>, Error>> {
	return dataRequestDebouncedPromise.execute(drId, async () => {
		const cachedValue = dataRequestCache.get(drId);

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

		if (!result.value) {
			return Result.ok(Maybe.nothing());
		}

		const dr = transformDataRequestFromContract(result.value);
		dataRequestCache.set(drId, dr);
		return Result.ok(Maybe.of(dr));
	});
}
