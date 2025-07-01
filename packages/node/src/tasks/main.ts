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
import {
	getEmbeddedCompileWorkerCode,
	getEmbeddedSyncExecuteWorkerCode,
	getEmbeddedVmWorkerCode,
} from "./execute-worker/worker-macro" with { type: "macro" };
import { FetchTask } from "./fetch";
import { IdentityManagerTask } from "./identity-manager";
import { EligibilityTask } from "./is-eligible";
import { BlockMonitorTask } from "./block-monitor";

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
	
	// RPC polling system (legacy/fallback)
	private fetchTask?: FetchTask;
	private eligibilityTask?: EligibilityTask;
	
	// gRPC block monitoring system (new)
	private blockMonitorTask?: BlockMonitorTask;
	
	// Shared components
	private identityManagerTask: IdentityManagerTask;
	public identityPool: IdentityPool;
	private executeWorkerPool: Maybe<WorkerPool> = Maybe.nothing();
	private compilerWorkerPool: Maybe<WorkerPool> = Maybe.nothing();
	private syncExecuteWorker: Maybe<WorkerPool> = Maybe.nothing();
	private mainTracer: Tracer;

	// These are the actual data requests we are currently processing and need to be completed before we move on
	public activeDataRequestTasks = 0;

	// Amount of data requests that have been completed, it doesn't necassarily mean that they have been fully resolved by the node.
	// Because sometimes a reveal could get stuck or the data request timed out.
	public completedDataRequests = 0;

	// We only want to process as much data requests as the node can handle.
	// That's why we keep track of data requests that we want to process before pushing them to active.
	public dataRequestsToProcess: DataRequestTask[] = [];

	// Map of active tasks by DR ID and identity ID for direct access by block monitor
	private activeTasksMap = new Map<string, DataRequestTask>();

	constructor(
		private config: AppConfig,
		private sedaChain: SedaChain,
	) {
		this.mainTracer = trace.getTracer("main-task");
		this.identityPool = new IdentityPool(config);
		this.identityManagerTask = new IdentityManagerTask(this.identityPool, config, sedaChain);
		
		// Only create legacy polling tasks if block monitoring is disabled or hybrid mode is enabled
		const useBlockMonitoring = this.config.node.experimental?.useBlockMonitoring ?? true;
		const hybridMode = this.config.node.experimental?.hybridMode ?? false;
		
		if (!useBlockMonitoring || hybridMode) {
			this.fetchTask = new FetchTask(this.pool, config, sedaChain);
			this.eligibilityTask = new EligibilityTask(this.pool, this.identityPool, config, sedaChain);
		}

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
		// When using block monitoring, process all queued DRs immediately in parallel
		if (this.blockMonitorTask) {
			// Process all queued tasks in parallel without limits
			const tasksToStart = [...this.dataRequestsToProcess];
			this.dataRequestsToProcess = [];
			
			if (tasksToStart.length > 0) {
				logger.info(`🚀 Starting ${tasksToStart.length} data request tasks in parallel`);
				
				for (const task of tasksToStart) {
					const taskKey = this.getTaskKey(task.getDrId(), task.getIdentityId());
					
					// Track the task in our map for block monitor access
					this.activeTasksMap.set(taskKey, task);
					
					task.on("done", () => {
						// Remove from active tasks map when done
						this.activeTasksMap.delete(taskKey);
						this.activeDataRequestTasks -= 1;
						this.completedDataRequests += 1;
					});
					
					task.start();
					this.activeDataRequestTasks += 1;
				}
			}
			return;
		}
		
		// Legacy mode: respect concurrency limits for RPC polling
		if (this.activeDataRequestTasks >= this.config.node.maxConcurrentRequests) return;

		const dataRequest = Maybe.of(this.dataRequestsToProcess.shift());
		if (dataRequest.isNothing) return;

		const task = dataRequest.value;
		const taskKey = this.getTaskKey(task.getDrId(), task.getIdentityId());

		// Track the task in our map for block monitor access
		this.activeTasksMap.set(taskKey, task);

		task.on("done", () => {
			// Remove from active tasks map when done
			this.activeTasksMap.delete(taskKey);
			this.activeDataRequestTasks -= 1;
			this.completedDataRequests += 1;
			this.processNextDr();
		});

		task.start();
		this.activeDataRequestTasks += 1;
	}

	private getTaskKey(drId: string, identityId: string): string {
		return `${drId}_${identityId}`;
	}

	// Public method for block monitor to access active tasks
	public getActiveTask(drId: string, identityId: string): DataRequestTask | undefined {
		const taskKey = this.getTaskKey(drId, identityId);
		return this.activeTasksMap.get(taskKey);
	}

	// Public method for block monitor to terminate a specific task
	public terminateTask(drId: string, identityId: string): void {
		const task = this.getActiveTask(drId, identityId);
		if (task) {
			logger.info(`🏁 Block monitor terminating completed task for DR ${drId}, identity ${identityId}`);
			task.forceStop(); // We'll add this method to DataRequestTask
		}
	}

	async start() {
		const span = this.mainTracer.startSpan("main-task-start");
		span.setAttribute("max_concurrent_requests", this.config.node.maxConcurrentRequests);
		span.setAttribute("process_dr_interval", this.config.node.processDrInterval);

		await this.identityManagerTask.start();
		
		// Determine which monitoring system to use
		const useBlockMonitoring = this.config.node.experimental?.useBlockMonitoring ?? true;
		const hybridMode = this.config.node.experimental?.hybridMode ?? false;
		const fallbackToRpc = this.config.node.experimental?.fallbackToRpc ?? true;
		
		if (useBlockMonitoring) {
			logger.info("🚀 Starting with real-time block monitoring");
			await this.startBlockMonitoring();
			
			if (hybridMode) {
				logger.info("🔄 Hybrid mode: also starting RPC polling for comparison");
				await this.startRpcPolling();
			}
		} else {
			logger.info("📡 Starting with RPC polling (legacy mode)");
			await this.startRpcPolling();
		}

		span.end();
	}
	
	private async startBlockMonitoring(): Promise<void> {
		try {
			// Pass 'this' reference so block monitor can directly terminate tasks
			this.blockMonitorTask = new BlockMonitorTask(this.config, this.sedaChain, this.identityPool, this.pool, this);
			
			const startResult = await this.blockMonitorTask.start();
			if (startResult.isErr) {
				throw startResult.error;
			}
			
			// Handle events from block monitoring
			this.blockMonitorTask.on('eligible', this.handleEligibleDR.bind(this));
			this.blockMonitorTask.on('readyForReveal', this.handleReadyForReveal.bind(this));
			this.blockMonitorTask.on('error', this.handleBlockMonitorError.bind(this));
			
			logger.info("Block monitoring started successfully");
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			logger.error(`Failed to start block monitoring: ${err.message}`);
			
			const fallbackToRpc = this.config.node.experimental?.fallbackToRpc ?? true;
			if (fallbackToRpc) {
				logger.warn("🔄 Falling back to RPC polling");
				await this.startRpcPolling();
			} else {
				throw err;
			}
		}
	}
	
	private async startRpcPolling(): Promise<void> {
		if (!this.fetchTask || !this.eligibilityTask) {
			throw new Error("Legacy polling tasks not initialized - cannot start RPC polling");
		}
		
		this.fetchTask.start();

		this.fetchTask.on("data-request", (_dataRequest) => {
			this.eligibilityTask!.process();
		});

		this.eligibilityTask.on("eligible", this.handleEligibleDRFromRpc.bind(this));
		
		logger.info("RPC polling started successfully");
	}
	
	private async handleEligibleDRFromRpc(drId: string, eligibilityHeight: bigint, identityId: string): Promise<void> {
		// Handle single identity from RPC polling
		this.createDataRequestTask(drId, identityId, eligibilityHeight);
	}
	
	private async handleEligibleDR(drId: string, identityIds: string[], eligibilityHeight: bigint): Promise<void> {
		// Handle multiple identities from block monitoring - create all tasks in parallel
		logger.info(`🚀 Creating ${identityIds.length} DR tasks in parallel for DR ${drId}`);
		
		const taskCreationPromises = identityIds.map((identityId) => {
			return Promise.resolve(this.createDataRequestTask(drId, identityId, eligibilityHeight));
		});
		
		// Wait for all tasks to be created in parallel
		await Promise.all(taskCreationPromises);
		
		logger.debug(`✅ Created ${identityIds.length} tasks in parallel for DR ${drId}`);
	}
	
	private createDataRequestTask(drId: string, identityId: string, eligibilityHeight: bigint): void {
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
			this.executeWorkerPool,
			this.compilerWorkerPool,
			this.syncExecuteWorker,
			this.blockMonitorTask, // Pass block monitor for commit tracking
		);
		
		// If using block monitoring, start task immediately for maximum parallelism
		if (this.blockMonitorTask) {
			const taskKey = this.getTaskKey(drId, identityId);
			
			// Track the task in our map for block monitor access
			this.activeTasksMap.set(taskKey, drTask);
			
			drTask.on("done", () => {
				// Remove from active tasks map when done
				this.activeTasksMap.delete(taskKey);
				this.activeDataRequestTasks -= 1;
				this.completedDataRequests += 1;
			});
			
			logger.debug(`🚀 Starting DR ${drId} task immediately for identity ${identityId}`);
			drTask.start();
			this.activeDataRequestTasks += 1;
		} else {
			// Legacy mode: queue for processing with concurrency limits
			this.dataRequestsToProcess.push(drTask);
			this.processNextDr();
		}
		
		eligibleSpan.end();
	}
	
	private async handleReadyForReveal(drId: string, identityIds: string[]): Promise<void> {
		// Handle reveal readiness from block monitoring
		logger.debug(`DR ${drId} ready for reveal by ${identityIds.length} identities`);
		// TODO: Implement reveal handling
	}
	
	private handleBlockMonitorError(error: Error): void {
		logger.error(`Block monitor error: ${error.message}`);
		
		const fallbackToRpc = this.config.node.experimental?.fallbackToRpc ?? true;
		if (fallbackToRpc) {
			logger.warn("🔄 Block monitoring failed, falling back to RPC polling");
			this.startRpcPolling().catch((fallbackError) => {
				logger.error(`Failed to start RPC fallback: ${fallbackError}`);
			});
		}
	}

	stop() {
		const span = this.mainTracer.startSpan("main-task-stop");
		span.setAttribute("active_tasks", this.activeDataRequestTasks);
		span.setAttribute("completed_requests", this.completedDataRequests);
		
		// Stop legacy polling tasks if they exist
		if (this.fetchTask) {
			this.fetchTask.stop();
		}
		if (this.blockMonitorTask) {
			this.blockMonitorTask.stop();
		}
		
		span.end();
	}

	getTransactionStats() {
		return {
			sedaChain: this.sedaChain.getTransactionStats(),
		};
	}

	isFetchTaskHealthy() {
		return this.fetchTask?.isFetchTaskHealthy ?? false;
	}
}
