import { DataRequestStatus as DRStatus } from "@seda-protocol/proto-messages/libs/proto-messages/gen/sedachain/core/v1/core";
import { tryAsync } from "@seda-protocol/utils";
import type { DataRequestStatus } from "@sedaprotocol/core-contract-schema";
import type { SedaChain } from "@sedaprotocol/overlay-ts-common";
import { Cache, DebouncedPromise } from "@sedaprotocol/overlay-ts-common";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Maybe, Result } from "true-myth";
import { isDrInRevealStage, transformDataRequestFromModule } from "../models/data-request";
import type { DataRequest } from "../models/data-request";

interface DataRequestsResponse {
	dataRequests: DataRequest[];
	total: number;
	isPaused: boolean;
	hasMore: boolean;
	lastSeenIndex: LastSeenIndex;
}

type LastSeenIndex = string[];
let lastSeenIndex: LastSeenIndex;

export async function getDataRequests(
	sedaChain: SedaChain,
	limit: number,
): Promise<Result<DataRequestsResponse, Error>> {
	const result = await tryAsync(
		sedaChain.getCoreQueryClient().DataRequestsByStatus({
			status: DRStatus.DATA_REQUEST_STATUS_COMMITTING,
			limit: BigInt(limit),
			lastSeenIndex: lastSeenIndex ?? [],
		}),
	);

	if (result.isErr) {
		return Result.err(new Error(`Failed to fetch committing data requests: ${result.error.message}`));
	}

	if (!result.value.dataRequests) {
		return Result.err(new Error("No committing data requests found"));
	}

	lastSeenIndex = result.value.lastSeenIndex;
	const dataRequests = result.value.dataRequests.map((request) => transformDataRequestFromModule(request));

	for (const dr of dataRequests) {
		dataRequestCache.set(dr.id, dr);
	}

	return Result.ok({
		dataRequests,
		total: result.value.total,
		isPaused: result.value.isPaused,
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

		const result = await tryAsync(sedaChain.getCoreQueryClient().DataRequest({ drId: drId }));

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

		if (!result.value.dataRequest) {
			return Result.ok(Maybe.nothing());
		}

		const dr = transformDataRequestFromModule(result.value.dataRequest);
		dataRequestCache.set(drId, dr);
		return Result.ok(Maybe.of(dr));
	});
}

export async function getDataRequestStatuses(
	sedaChain: SedaChain,
	drId: string,
): Promise<Result<Maybe<DataRequestStatus>, Error>> {
	// We should first check the cache to avoid unnecessary queries
	// It coud take a bit longer for committs to come in, and the paginated fetch data requests call is already refreshing the cache
	const cachedValue = dataRequestCache.get(drId);

	if (cachedValue.isJust) {
		if (isDrInRevealStage(cachedValue.value)) {
			return Result.ok(Maybe.just("revealing"));
		}

		return Result.ok(Maybe.just("committing"));
	}

	const result = await tryAsync(sedaChain.getCoreQueryClient().DataRequestStatuses({ dataRequestIds: [drId] }));

	if (result.isErr) {
		return Result.err(result.error);
	}

	if (!result.value.statuses[drId] || !result.value.statuses[drId].value) {
		return Result.ok(Maybe.nothing());
	}

	let status: DataRequestStatus;
	switch (result.value.statuses[drId].value) {
		case DRStatus.DATA_REQUEST_STATUS_COMMITTING:
			status = "committing";
			break;
		case DRStatus.DATA_REQUEST_STATUS_REVEALING:
			status = "revealing";
			break;
		case DRStatus.DATA_REQUEST_STATUS_TALLYING:
			status = "tallying";
			break;
		default:
			return Result.ok(Maybe.nothing());
	}
	return Result.ok(Maybe.of(status));
}
