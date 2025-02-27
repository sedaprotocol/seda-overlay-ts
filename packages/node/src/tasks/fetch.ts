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
	private offset = 0;

	constructor(
		private pool: DataRequestPool,
		private config: AppConfig,
		private sedaChain: SedaChain,
	) {
		super();
	}

	async fetch(): Promise<Result<Unit, Error>> {
		logger.info("🔎 Looking for Data Requests..");
		logger.debug(`Fetching: ${this.offset}-${this.offset + LIMIT}`);

		const result = await getDataRequests(this.sedaChain, this.offset, LIMIT);

		if (result.isErr) {
			return Result.err(result.error);
		}

		if (result.value.length < LIMIT) {
			this.offset = 0;
		} else {
			this.offset = this.offset + LIMIT;
		}

		for (const dataRequest of result.value) {
			if (this.pool.hasDataRequest(dataRequest.id)) {
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
