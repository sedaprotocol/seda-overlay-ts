import { writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";
import { type SedaChain, WorkerPool } from "@sedaprotocol/overlay-ts-common";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Maybe } from "true-myth";
import { version } from "../../../../package.json";
import { DataRequestTask } from "../data-request-task";
import { DataRequestPool } from "../models/data-request-pool";
import { IdentityPool } from "../models/identitiest-pool";
import {
	getEmbeddedCompileWorkerCode,
	getEmbeddedSyncExecuteWorkerCode,
	getEmbeddedVmWorkerCode,
} from "./execute-worker/worker-macro" with { type: "macro" };
import { FetchTask } from "./fetch";
import { IdentityManagerTask } from "./identity-manager";
import { EligibilityTask } from "./is-eligible";

// Embed worker code so we can ouput a single binary
const executeWorkerCode = getEmbeddedVmWorkerCode();
const executeBlob = new Blob([executeWorkerCode]);
const executeWorkerSrc = URL.createObjectURL(executeBlob);

const compilerWorkerCode = getEmbeddedCompileWorkerCode();
const compilerBlob = new Blob([compilerWorkerCode]);
const compilerWorkerSrc = URL.createObjectURL(compilerBlob);

const syncExecuteWorkerCode = getEmbeddedSyncExecuteWorkerCode();
const syncExecuteWorkerBlob = new Blob([syncExecuteWorkerCode]);
const syncExecuteWorkerSrc = URL.createObjectURL(syncExecuteWorkerBlob);

/// In Node.js we need to write the workers to disk so we can use them in the worker pool
/// We can't use the URL.createObjectURL() method for Web Workers because it's not supported in Node.js
function writeWorkersToDisk(workersDir: string) {
	if (typeof Bun !== "undefined") {
		return {
			executeWorkerSrc,
			compilerWorkerSrc,
			syncExecuteWorkerSrc,
		};
	}

	const compilerWorkerPath = path.join(workersDir, `compile-worker-${version}.js`);
	const executeWorkerPath = path.join(workersDir, `execute-worker-${version}.js`);
	const syncExecuteWorkerPath = path.join(workersDir, `sync-execute-worker-${version}.js`);

	writeFileSync(compilerWorkerPath, compilerWorkerCode);
	writeFileSync(executeWorkerPath, executeWorkerCode);
	writeFileSync(syncExecuteWorkerPath, syncExecuteWorkerCode);

	return {
		executeWorkerSrc: executeWorkerPath,
		compilerWorkerSrc: compilerWorkerPath,
		syncExecuteWorkerSrc: syncExecuteWorkerPath,
	};
}

export class MainTask {
	public pool: DataRequestPool = new DataRequestPool();
	private fetchTask: FetchTask;
	private identityManagerTask: IdentityManagerTask;
	public identityPool: IdentityPool;
	private eligibilityTask: EligibilityTask;
	private executeWorkerPool: Maybe<WorkerPool> = Maybe.nothing();
	private compilerWorkerPool: Maybe<WorkerPool> = Maybe.nothing();
	private syncExecuteWorker: Maybe<WorkerPool> = Maybe.nothing();

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
		this.identityPool = new IdentityPool(config);

		this.fetchTask = new FetchTask(this.pool, config, sedaChain);
		this.identityManagerTask = new IdentityManagerTask(this.identityPool, config, sedaChain);
		this.eligibilityTask = new EligibilityTask(this.pool, this.identityPool, config, sedaChain);

		let threadsAvailable = availableParallelism();

		const workersPaths = writeWorkersToDisk(config.workersDir);

		if (!config.node.forceSyncVm && threadsAvailable >= 2) {
			logger.debug(
				`Parallel execution mode activated. (Threads available: ${threadsAvailable}). Terminate after completion: ${config.node.terminateAfterCompletion}`,
			);
			threadsAvailable = threadsAvailable - 1;

			this.compilerWorkerPool = Maybe.just(new WorkerPool(workersPaths.compilerWorkerSrc, threadsAvailable));
			this.executeWorkerPool = Maybe.just(
				new WorkerPool(workersPaths.executeWorkerSrc, threadsAvailable, config.node.terminateAfterCompletion),
			);
		} else {
			logger.debug(
				`Synchronous execution mode activated. (Threads available: ${threadsAvailable}). Terminate after completion: ${config.node.terminateAfterCompletion}`,
			);

			if (config.node.threadAmount) {
				logger.debug(`Using configured thread amount: ${config.node.threadAmount}`);
			}

			this.syncExecuteWorker = Maybe.just(
				new WorkerPool(
					workersPaths.syncExecuteWorkerSrc,
					config.node.threadAmount ?? threadsAvailable,
					config.node.terminateAfterCompletion,
				),
			);
		}

		setInterval(() => this.processNextDr(), this.config.node.processDrInterval);
	}

	private processNextDr() {
		if (this.activeDataRequestTasks >= this.config.node.maxConcurrentRequests) return;

		const dataRequest = Maybe.of(this.dataRequestsToProcess.shift());
		if (dataRequest.isNothing) return;

		dataRequest.value.on("done", () => {
			this.activeDataRequestTasks -= 1;
			this.completedDataRequests += 1;

			this.processNextDr();
		});

		dataRequest.value.start();
		this.activeDataRequestTasks += 1;
	}

	async start() {
		await this.identityManagerTask.start();
		this.fetchTask.start();

		this.fetchTask.on("data-request", (_dataRequest) => {
			this.eligibilityTask.process();
		});

		this.eligibilityTask.on("eligible", async (drId, identityId) => {
			const drTask = new DataRequestTask(
				this.pool,
				this.identityPool,
				this.config,
				this.sedaChain,
				drId,
				identityId,
				this.executeWorkerPool,
				this.compilerWorkerPool,
				this.syncExecuteWorker,
			);
			this.dataRequestsToProcess.push(drTask);
			this.processNextDr();
		});
	}

	stop() {
		this.fetchTask.stop();
	}

	getTransactionStats() {
		return {
			sedaChain: this.sedaChain.getTransactionStats(),
		};
	}
}
