import { writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";
import { type Tracer, trace } from "@opentelemetry/api";
import { type SedaChain, WorkerPool } from "@sedaprotocol/overlay-ts-common";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Maybe } from "true-myth";
import { version } from "../../../../package.json";
import { DataRequestTask } from "../data-request-task";
import { DataRequestPool } from "../models/data-request-pool";
import { IdentityPool } from "../models/identitiest-pool";
import { getEmbeddedSyncExecuteWorkerCode } from "./execute-worker/worker-macro" with { type: "macro" };
import { FetchTask } from "./fetch";
import { IdentityManagerTask } from "./identity-manager";
import { EligibilityTask } from "./is-eligible";

const syncExecuteWorkerCode = getEmbeddedSyncExecuteWorkerCode();
const syncExecuteWorkerBlob = new Blob([syncExecuteWorkerCode]);
const syncExecuteWorkerSrc = URL.createObjectURL(syncExecuteWorkerBlob);

/// In Node.js we need to write the workers to disk so we can use them in the worker pool
/// We can't use the URL.createObjectURL() method for Web Workers because it's not supported in Node.js
function writeWorkersToDisk(workersDir: string) {
	if (typeof Bun !== "undefined") {
		return {
			syncExecuteWorkerSrc,
		};
	}

	const syncExecuteWorkerPath = path.join(workersDir, `sync-execute-worker-${version}.js`);
	writeFileSync(syncExecuteWorkerPath, syncExecuteWorkerCode);

	return {
		syncExecuteWorkerSrc: syncExecuteWorkerPath,
	};
}

export class MainTask {
	public pool: DataRequestPool = new DataRequestPool();
	private fetchTask: FetchTask;
	private identityManagerTask: IdentityManagerTask;
	public identityPool: IdentityPool;
	private eligibilityTask: EligibilityTask;
	private syncExecuteWorker: WorkerPool;
	private mainTracer: Tracer;

	// These are the actual data requests we are currently processing and need to be completed before we move on
	public activeDataRequestTasks = 0;

	// Amount of data requests that have been completed, it doesn't necassarily mean that they have been fully resolved by the node.
	// Because sometimes a reveal could get stuck or the data request timed out.
	public completedDataRequests = 0;

	// We only want to process as much data requests as the node can handle.
	// That's why we keep track of data requests that we want to process before pushing them to active.
	public dataRequestsToProcess: DataRequestTask[] = [];

	constructor(
		private config: AppConfig,
		private sedaChain: SedaChain,
	) {
		this.mainTracer = trace.getTracer("main-task");
		this.identityPool = new IdentityPool(config);
		this.fetchTask = new FetchTask(this.pool, config, sedaChain);
		this.identityManagerTask = new IdentityManagerTask(this.identityPool, config, sedaChain);
		this.eligibilityTask = new EligibilityTask(this.pool, this.identityPool, config, sedaChain);

		const threadsAvailable = availableParallelism();
		const workersPaths = writeWorkersToDisk(config.workersDir);

		logger.debug(
			`Threads available: ${threadsAvailable}. Terminate after completion: ${config.node.terminateAfterCompletion}`,
		);

		if (config.node.threadAmount) {
			logger.debug(`Using configured thread amount: ${config.node.threadAmount}`);
		}

		this.syncExecuteWorker = new WorkerPool(
			workersPaths.syncExecuteWorkerSrc,
			config.node.threadAmount ?? threadsAvailable,
			config.node.terminateAfterCompletion,
		);

		setInterval(() => this.processNextDr(), this.config.node.processDrInterval);
	}

	/**
	 * Finds the next data request with the highest gas price. These data requests tasks are already eligible.
	 * This is used to prioritize data requests that have a higher gas price.
	 *
	 * @returns The data request task with the highest gas price.
	 */
	private findHighestGasPriceRequest(): Maybe<DataRequestTask> {
		if (this.dataRequestsToProcess.length === 0) return Maybe.nothing();

		let highestGasPrice = 0n;
		let highestGasPriceDataRequest: Maybe<DataRequestTask> = Maybe.nothing();
		let highestGasPriceIndex = 0;

		for (let index = 0; index < this.dataRequestsToProcess.length; index++) {
			const dataRequestTask = this.dataRequestsToProcess[index];
			const dataRequest = this.pool.getDataRequest(dataRequestTask.drId);
			if (dataRequest.isNothing) continue;

			if (dataRequest.value.postedGasPrice > highestGasPrice) {
				highestGasPrice = dataRequest.value.postedGasPrice;
				highestGasPriceDataRequest = Maybe.just(dataRequestTask);
				highestGasPriceIndex = index;
			}
		}

		// Remove the data request task with the highest gas price from the list
		// Otherwise we will process the same data request task multiple times
		this.dataRequestsToProcess.splice(highestGasPriceIndex, 1);

		return highestGasPriceDataRequest;
	}

	private processNextDr() {
		if (this.activeDataRequestTasks >= this.config.node.maxConcurrentRequests) return;

		const dataRequest = this.findHighestGasPriceRequest();
		if (dataRequest.isNothing) return;

		logger.info("🤖 Processing Data Request", {
			id: dataRequest.value.drId,
		});

		dataRequest.value.on("done", () => {
			this.activeDataRequestTasks -= 1;
			this.completedDataRequests += 1;
			this.processNextDr();
		});

		dataRequest.value.start();
		this.activeDataRequestTasks += 1;
	}

	async start() {
		const span = this.mainTracer.startSpan("main-task-start");
		span.setAttribute("max_concurrent_requests", this.config.node.maxConcurrentRequests);
		span.setAttribute("process_dr_interval", this.config.node.processDrInterval);

		await this.identityManagerTask.start();
		this.fetchTask.start();

		this.fetchTask.on("data-request", (_dataRequest) => {
			this.eligibilityTask.process();
		});

		this.eligibilityTask.on("eligible", async (drId, eligibilityHeight, identityId) => {
			const eligibleSpan = this.mainTracer.startSpan("data-request-eligible");
			eligibleSpan.setAttribute("dr_id", drId);
			eligibleSpan.setAttribute("identity_id", identityId);

			const drTask = new DataRequestTask(
				this.pool,
				this.identityPool,
				this.config,
				this.sedaChain,
				drId,
				identityId,
				eligibilityHeight,
				this.syncExecuteWorker,
			);

			this.dataRequestsToProcess.push(drTask);
			eligibleSpan.end();
			this.processNextDr();
		});

		logger.info("Overlay node started and running");
		span.end();
	}

	stop() {
		const span = this.mainTracer.startSpan("main-task-stop");
		span.setAttribute("active_tasks", this.activeDataRequestTasks);
		span.setAttribute("completed_requests", this.completedDataRequests);
		this.fetchTask.stop();
		span.end();
	}

	getTransactionStats() {
		return {
			sedaChain: this.sedaChain.getTransactionStats(),
		};
	}

	isFetchTaskHealthy() {
		return this.fetchTask.isFetchTaskHealthy;
	}
}
