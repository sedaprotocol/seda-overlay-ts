import { type Span, type Tracer, context, trace } from "@opentelemetry/api";
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
	private fetchTracer: Tracer;

	// Metrics:
	public isFetchTaskHealthy: boolean | undefined = undefined;
	private fetchCountLastRefresh = 0;
	private failedFetchCount = 0;
	private totalFetchCount = 0;
	private fetchFailureThreshold;
	private fetchCountRefreshInterval;

	constructor(
		private pool: DataRequestPool,
		private config: AppConfig,
		private sedaChain: SedaChain,
	) {
		super();
		this.fetchTracer = trace.getTracer("fetch");

		this.fetchFailureThreshold = config.node.fetchFailureThreshold;
		this.fetchCountRefreshInterval = config.node.fetchCountRefreshInterval;
	}

	async fetch(parentSpan?: Span): Promise<Result<Unit, Error>> {
		let span: Span;

		if (parentSpan) {
			const ctx = trace.setSpan(context.active(), parentSpan);
			span = this.fetchTracer.startSpan("fetch", undefined, ctx);
		} else {
			span = this.fetchTracer.startSpan("fetch");
		}

		span.setAttribute("drFetchLimit", this.config.node.drFetchLimit);

		this.addFetchCount();

		logger.info("🔎 Looking for Data Requests...");
		const result = await getDataRequests(this.sedaChain, this.config.node.drFetchLimit);

		if (result.isErr) {
			span.recordException(result.error);
			span.end();
			this.failedFetchCount++;
			return Result.err(result.error);
		}

		logger.debug(
			`Fetched ${result.value.dataRequests.length} Data Requests in committing status (total: ${result.value.total})`,
		);

		span.setAttribute("fetchedDataRequests", result.value.dataRequests.length);
		span.setAttribute("totalDataRequests", result.value.total);

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
		span.setAttribute("hasMore", result.value.hasMore);

		if (result.value.hasMore) {
			await this.fetch(span);
		}

		if (this.pool.size < result.value.total) {
			span.setAttribute("missingDataRequests", result.value.total - this.pool.size);
			logger.trace(
				`Data requests in memory pool: ${this.pool.size} vs on chain: ${result.value.total} (missing ${result.value.total - this.pool.size})`,
			);
		}

		// Emit data requests sequentially after they are added to the pool to ensure a single process() call handles them
		for (const dataRequest of newDataRequests) {
			this.emit("data-request", dataRequest);
		}

		span.end();
		return Result.ok();
	}

	start() {
		this.timerId = Maybe.just(
			debouncedInterval(async () => {
				(await this.fetch()).mapErr((error) => {
					logger.error(`FetchTask: ${error}`);
					// TODO: Discuss how do we handle this ERROR for alerting & monitoring.
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

	/**
	 * Increments the total fetch count, refreshing the counter if necessary.
	 * Updates lastFetchTaskStatus during refresh to indicate if more than 50% of fetches failed in the previous interval.
	 * @private
	 */
	private addFetchCount() {
		const now = Date.now();
		if (now - this.fetchCountLastRefresh >= this.fetchCountRefreshInterval) {
			if (this.fetchCountLastRefresh) {
				this.isFetchTaskHealthy = this.failedFetchCount < this.totalFetchCount * this.fetchFailureThreshold;
			}
			this.totalFetchCount = 1;
			this.failedFetchCount = 0;
			this.fetchCountLastRefresh = now;
		} else {
			this.totalFetchCount++;
		}
	}
}
