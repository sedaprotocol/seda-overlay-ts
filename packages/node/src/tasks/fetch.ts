import { debouncedInterval } from "@sedaprotocol/overlay-ts-common";
import type { SedaChain } from "@sedaprotocol/overlay-ts-common";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { EventEmitter } from "eventemitter3";
import { Maybe, Result, type Unit } from "true-myth";
import type { DataRequest } from "../models/data-request";
import type { DataRequestPool } from "../models/data-request-pool";
import { getDataRequests } from "../services/get-data-requests";

const LIMIT = 10;

type EventMap = {
	"data-request": [DataRequest];
};

export class FetchTask extends EventEmitter<EventMap> {
	private timerId: Maybe<Timer> = Maybe.nothing();
	// private lastSeenIndex: Maybe<number> = Maybe.nothing();

	constructor(
		private pool: DataRequestPool,
		private config: AppConfig,
		private sedaChain: SedaChain,
	) {
		super();
	}

	async fetch(): Promise<Result<Unit, Error>> {
		logger.info("🔎 Looking for Data Requests...");

		const result = await getDataRequests(this.sedaChain, LIMIT);

		if (result.isErr) {
			return Result.err(result.error);
		}

		logger.debug(`Found ${result.value.dataRequests.length}/${result.value.total} Data Requests in committing status`);
		const newDataRequests: DataRequest[] = [];
		for (const dataRequest of result.value.dataRequests) {
			if (this.pool.hasDataRequest(dataRequest.id)) {
				logger.debug("Data Request already exists in the pool, skipping", {id: dataRequest.id});
				// Always update the pool
				this.pool.insertDataRequest(dataRequest);
				continue;
			}

			// TODO: Check if the reveal already started
			// TODO: Check if the start up cost is worth it
			logger.info("🆕 Found new Data Request", {
				id: dataRequest.id,
			});

			this.pool.insertDataRequest(dataRequest);
			newDataRequests.push(dataRequest);
		}

		// Emit data requests sequentially after they are added to the pool to ensure a single process() call handles them
		for (const dataRequest of newDataRequests) {
			this.emit("data-request", dataRequest);
		}

		return Result.ok();
	}

	start() {
		this.timerId = Maybe.just(
			debouncedInterval(async () => {
				(await this.fetch()).mapErr((error) => {
					logger.error(`FetchTask: ${error}`);
				});
			}, this.config.intervals.fetchTask),
		);
	}

	stop() {
		this.timerId.match({
			Just: (timer) => clearInterval(timer),
			Nothing: () => { },
		});
	}
}
