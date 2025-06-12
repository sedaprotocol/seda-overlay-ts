import { debouncedInterval } from "@sedaprotocol/overlay-ts-common";
import type { SedaChain } from "@sedaprotocol/overlay-ts-common";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { EventEmitter } from "eventemitter3";
import { Maybe, Result, type Unit } from "true-myth";
import { type DataRequest, isDrInRevealStage } from "../models/data-request";
import type { DataRequestPool } from "../models/data-request-pool";
import { getDataRequests } from "../services/get-data-requests";

type EventMap = {
	"data-request": [DataRequest];
};

export class FetchTask extends EventEmitter<EventMap> {
	private timerId: Maybe<Timer> = Maybe.nothing();

	constructor(
		private pool: DataRequestPool,
		private config: AppConfig,
		private sedaChain: SedaChain,
	) {
		super();
	}

	async fetch(): Promise<Result<Unit, Error>> {
		logger.info("🔎 Looking for Data Requests...");
		const startFetchingTime = performance.now();
		const result = await getDataRequests(this.sedaChain, this.config.node.drFetchLimit);
		const endFetchingTime = performance.now();

		logger.trace(`Fetching time: ${endFetchingTime - startFetchingTime}ms`);

		if (result.isErr) {
			return Result.err(result.error);
		}

		logger.debug(
			`Fetched ${result.value.dataRequests.length} Data Requests in committing status (total: ${result.value.total})`,
		);

		const newDataRequests: DataRequest[] = [];
		for (const dataRequest of result.value.dataRequests) {
			if (this.pool.hasDataRequest(dataRequest.id)) {
				// Always update the pool
				this.pool.insertDataRequest(dataRequest);
				continue;
			}

			// When the data request is in the reveal stage we can't process it
			// other nodes will take care of it
			if (isDrInRevealStage(dataRequest)) {
				logger.debug("Skipping fetched data request in reveal stage", {
					id: dataRequest.id,
				});
				continue;
			}

			// TODO: Check if the start up cost is worth it
			logger.info("🆕 Found new Data Request", {
				id: dataRequest.id,
			});

			this.pool.insertDataRequest(dataRequest);
			newDataRequests.push(dataRequest);
		}

		if (result.value.hasMore) {
			await this.fetch();
		}

		if (this.pool.size < result.value.total) {
			logger.trace(`Data requests in memory pool: ${this.pool.size} vs on chain: ${result.value.total} (missing ${result.value.total - this.pool.size})`);
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
			Nothing: () => {},
		});
	}
}
