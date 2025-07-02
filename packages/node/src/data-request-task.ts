import { type Span, type Tracer, context, trace } from "@opentelemetry/api";
import {
	AlreadyCommitted,
	AlreadyRevealed,
	DataRequestExpired,
	DataRequestNotFound,
	JSONStringify,
	RevealMismatch,
	RevealStarted,
	debouncedInterval,
	sleep,
} from "@sedaprotocol/overlay-ts-common";
import type { SedaChain, WorkerPool } from "@sedaprotocol/overlay-ts-common";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { DEFAULT_MAX_REVEAL_SIZE } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { EventEmitter } from "eventemitter3";
import { Maybe } from "true-myth";
import { EXECUTION_EXIT_CODE_RESULT_TOO_LARGE } from "./constants";
import { type DataRequest, isDrInRevealStage } from "./models/data-request";
import { type DataRequestPool, IdentityDataRequestStatus } from "./models/data-request-pool";
import type { ExecutionResult } from "./models/execution-result";
import type { IdentityPool } from "./models/identitiest-pool";
import { getDataRequest } from "./services/get-data-requests";
import { commitDr } from "./tasks/commit";
import { executeDataRequest } from "./tasks/execute";
import { revealDr } from "./tasks/reveal";
import type { BlockMonitorTask } from "./tasks/block-monitor";

type EventMap = {
	done: [];
};

export class DataRequestTask extends EventEmitter<EventMap> {
	private status: IdentityDataRequestStatus = IdentityDataRequestStatus.EligibleForExecution;
	private retries = 0;
	public name: string;
	private executionResult: Maybe<ExecutionResult> = Maybe.nothing();
	private refreshDataRequestDataIntervalId: Maybe<Timer> = Maybe.nothing();
	private executeDrIntervalId: Maybe<Timer> = Maybe.nothing();
	private isProcessing = false;
	private commitHash: Buffer = Buffer.alloc(0);
	private revealSubmitted = false; // Track if we've submitted the reveal transaction
	private drTracer: Tracer;
	private rootSpan: Span;
	private rootContext: ReturnType<typeof context.active>;
	private blockMonitor?: BlockMonitorTask; // Optional block monitor for commit tracking

	constructor(
		private pool: DataRequestPool,
		private identitityPool: IdentityPool,
		private appConfig: AppConfig,
		private sedaChain: SedaChain,
		private drId: string,
		private identityId: string,
		private eligibilityHeight: bigint,
		private executeWorkerPool: Maybe<WorkerPool>,
		private compilerWorkerPool: Maybe<WorkerPool>,
		private syncExecuteWorker: Maybe<WorkerPool>,
		blockMonitor?: BlockMonitorTask, // Optional block monitor
	) {
		super();

		this.name = `${drId}_${identityId}`;
		this.drTracer = trace.getTracer("data-request-task");
		this.rootSpan = this.drTracer.startSpan("data-request-lifecycle");
		this.rootContext = trace.setSpan(context.active(), this.rootSpan);
		this.rootSpan.setAttribute("dr_id", this.drId);
		this.rootSpan.setAttribute("identity_id", this.identityId);
		this.rootSpan.setAttribute("start_time", new Date().toISOString());
		this.blockMonitor = blockMonitor;

		// Listen for readyForReveal events from block monitor if available
		if (this.blockMonitor) {
			this.blockMonitor.on('readyForReveal', this.handleReadyForRevealEvent.bind(this));
			this.blockMonitor.on('revealConfirmed', this.handleRevealConfirmedEvent.bind(this));
		}
	}

	/**
	 * Handle readyForReveal event from block monitor
	 */
	private handleReadyForRevealEvent(drId: string, identityIds: string[]): void {
		logger.debug(`🔔 Received readyForReveal event: drId=${drId}, identityIds=[${identityIds.join(',')}], ourDrId=${this.drId}, ourIdentityId=${this.identityId}`, {
			id: this.name,
		});
		
		if (drId !== this.drId || !identityIds.includes(this.identityId)) {
			logger.debug(`🚫 Event not for this task (DR mismatch: ${drId !== this.drId}, identity mismatch: ${!identityIds.includes(this.identityId)})`, {
				id: this.name,
			});
			return; // Not for this task
		}

		logger.info(`🚀 Block monitor detected reveal readiness for DR ${drId}`, {
			id: this.name,
		});
		
		// Transition to ready for reveal status 
		this.transitionStatus(IdentityDataRequestStatus.ReadyToBeRevealed);
		
		// Continue processing to submit the reveal
		if (this.blockMonitor) {
			this.continueProcessingAfterEvent();
		}
	}

	/**
	 * Handle revealConfirmed event from block monitor
	 */
	private handleRevealConfirmedEvent(drId: string, identityId: string): void {
		logger.debug(`🎉 Received revealConfirmed event: drId=${drId}, identityId=${identityId}, ourDrId=${this.drId}, ourIdentityId=${this.identityId}`, {
			id: this.name,
		});
		
		if (drId !== this.drId || identityId !== this.identityId) {
			logger.debug(`🚫 Reveal confirmation not for this task (DR mismatch: ${drId !== this.drId}, identity mismatch: ${identityId !== this.identityId})`, {
				id: this.name,
			});
			return; // Not for this task
		}

		logger.info(`✅ Block monitor confirmed our reveal on-chain for DR ${drId}`, {
			id: this.name,
		});
		
		// Transition to revealed status now that it's confirmed on-chain
		this.transitionStatus(IdentityDataRequestStatus.Revealed);
	}

	private transitionStatus(toStatus: IdentityDataRequestStatus) {
		this.retries = 0;
		this.status = toStatus;
		this.pool.insertIdentityDataRequest(this.drId, this.identityId, this.eligibilityHeight, Maybe.nothing(), toStatus);
		this.rootSpan.setAttribute("current_status", toStatus);
	}

	private stop() {
		this.refreshDataRequestDataIntervalId.match({
			Just: (id) => clearInterval(id),
			Nothing: () => {},
		});

		this.executeDrIntervalId.match({
			Just: (id) => clearInterval(id),
			Nothing: () => {},
		});

		// We only delete the identity, since we cannot be sure that the data request is still being used somewhere else
		this.pool.deleteIdentityDataRequest(this.drId, this.identityId);

		this.rootSpan.setAttribute("end_time", new Date().toISOString());
		this.rootSpan.setAttribute("final_status", this.status);
		this.rootSpan.setAttribute("total_retries", this.retries);
		this.rootSpan.end();

		this.emit("done");
	}

	// Public methods for external access
	public getDrId(): string {
		return this.drId;
	}

	public getIdentityId(): string {
		return this.identityId;
	}

	public forceStop(): void {
		logger.info(`🛑 Force stopping task for DR ${this.drId}, identity ${this.identityId}`, {
			id: this.name,
		});
		this.stop();
	}

	private async processUntilWaitingState(): Promise<void> {
		try {
			// Process repeatedly until we reach a waiting state - no delays, no polling
			let maxIterations = 10; // Safety guard against infinite loops
			let iterations = 0;
			
			while (iterations < maxIterations) {
				const previousStatus = this.status;
				await this.process();
				iterations++;
				
				// Check if we've reached a waiting state
				if (this.status === IdentityDataRequestStatus.Committed) {
					logger.debug(`Task for DR ${this.drId} committed, now waiting for block monitor to detect sufficient commits`, {
						id: this.name,
					});
					break;
				}
				
				if (this.status === IdentityDataRequestStatus.ReadyToBeRevealed && this.revealSubmitted) {
					logger.debug(`Task for DR ${this.drId} submitted reveal, now waiting for block monitor to confirm on-chain`, {
						id: this.name,
					});
					break;
				}
				
				if (this.status === IdentityDataRequestStatus.Revealed) {
					logger.debug(`Task for DR ${this.drId} completed`, {
						id: this.name,
					});
					break;
				}
				
				// If status didn't change, we're probably stuck - stop processing
				if (this.status === previousStatus) {
					logger.debug(`Task for DR ${this.drId} status unchanged (${this.status}), stopping processing`, {
						id: this.name,
					});
					break;
				}
			}
			
			if (iterations >= maxIterations) {
				logger.warn(`Task for DR ${this.drId} hit max processing iterations, stopping`, {
					id: this.name,
				});
			}
		} catch (error) {
			logger.error(`Error in processing for DR ${this.drId}: ${error}`, {
				id: this.name,
			});
		}
	}

	private continueProcessingAfterEvent(): void {
		// Continue processing after receiving a block monitor event
		logger.debug(`Continuing processing after block monitor event for DR ${this.drId}`, {
			id: this.name,
		});
		
		// Use setTimeout to avoid blocking the event handler
		setTimeout(() => {
			this.processUntilWaitingState().catch((error: Error) => {
				logger.error(`Error continuing processing after event for DR ${this.drId}: ${error}`, {
					id: this.name,
				});
			});
		}, 0);
	}

	public start() {
		const span = this.drTracer.startSpan("start-data-request", undefined, this.rootContext);
		span.setAttribute("dr_id", this.drId);
		span.setAttribute("identity_id", this.identityId);

		logger.trace("Starting data request task", {
			id: this.name,
		});

		if (this.blockMonitor) {
			// With block monitoring: process until we reach a waiting state, then let block monitor drive
			logger.debug(`Task for DR ${this.drId} starting in block monitoring mode - processing until waiting state`, {
				id: this.name,
			});
			
			// Process until we reach a waiting state
			this.processUntilWaitingState();
		} else {
			// Legacy mode: set up polling intervals
			logger.debug(`Task for DR ${this.drId} starting in legacy polling mode`, {
				id: this.name,
			});
			
			this.refreshDataRequestDataIntervalId = Maybe.of(
				debouncedInterval(async () => {
					await this.handleRefreshDataRequestData(this.drId);
				}, this.appConfig.intervals.statusCheck),
			);

			this.executeDrIntervalId = Maybe.of(
				debouncedInterval(async () => {
					await this.process();
				}, this.appConfig.intervals.drTask),
			);
		}

		span.end();
	}

	async process(): Promise<void> {
		const span = this.drTracer.startSpan("process-data-request", undefined, this.rootContext);
		span.setAttribute("dr_id", this.drId);
		span.setAttribute("identity_id", this.identityId);
		span.setAttribute("status", this.status);
		
		span.setAttribute("retries", this.retries);

		try {
			if (this.isProcessing) {
				logger.debug(`Already processing, skipping while on status: ${this.status}`, {
					id: this.name,
				});
				span.end();
				return;
			}
			this.isProcessing = true;

			// Always get the data request from our single source of truth
			const dataRequest = this.pool.getDataRequest(this.drId);

			// The data request has been removed from the pool. We can safely close the process.
			if (dataRequest.isNothing) {
				logger.info("✅ Data Request has been resolved on chain", {
					id: this.name,
				});
				span.setAttribute("final_status", "resolved");
				span.end();
				this.stop();
				return;
			}

			// Check if we've exceeded retry limit
			if (this.retries > this.appConfig.sedaChain.maxRetries) {
				logger.error("Exceeded maximum retry attempts, marking data request as failed", {
					id: this.name,
				});
				this.status = IdentityDataRequestStatus.Failed;
				span.setAttribute("final_status", "failed");
				span.setAttribute("failure_reason", "max_retries_exceeded");
				span.end();
				this.stop();
				return;
			}

			if (this.status === IdentityDataRequestStatus.EligibleForExecution) {
				// 🚀 TIMING: Record execution start in state manager
				if (this.blockMonitor) {
					this.blockMonitor.recordExecutionStarted(this.drId, this.identityId);
				}
				await this.handleExecution(dataRequest.value);
			} else if (this.status === IdentityDataRequestStatus.Executed) {
				await this.handleCommit(dataRequest.value);
			} else if (this.status === IdentityDataRequestStatus.Committed) {
				// If we have block monitoring, wait for readyForReveal event instead of polling
				if (this.blockMonitor) {
					// Do nothing - block monitor will emit readyForReveal event when conditions are met
					logger.debug(`Waiting for block monitor to detect sufficient commits for DR ${this.drId}`, {
						id: this.name,
					});
					return;
				} else {
					// Legacy polling mode - check if ready to reveal
					await this.handleCheckReadyToBeRevealed(dataRequest.value.id);
				}
			} else if (this.status === IdentityDataRequestStatus.ReadyToBeRevealed) {
				// Submit reveal once, then wait for block monitor to confirm
				if (this.blockMonitor) {
					if (!this.revealSubmitted) {
						logger.debug(`🎯 Submitting reveal for DR ${this.drId}`, {
							id: this.name,
						});
						await this.handleReveal(dataRequest.value);
						logger.debug(`Reveal submitted for DR ${this.drId}, waiting for block monitor to confirm`, {
							id: this.name,
						});
					}
					// Don't continue processing - block monitor will handle completion
					return;
				} else {
					// Legacy mode without block monitoring - always attempt reveal
					logger.debug(`🎯 Processing ReadyToBeRevealed status for DR ${this.drId} (legacy mode)`, {
						id: this.name,
					});
					await this.handleReveal(dataRequest.value);
				}
			} else if (this.status === IdentityDataRequestStatus.Revealed) {
				logger.info("🎉 Completed", {
					id: this.name,
				});
				this.stop();
				return;
			} else {
				logger.error(`Unimplemented status ${this.status}, aborting data-request`, {
					id: this.name,
				});
				span.setAttribute("final_status", "error");
				span.setAttribute("error_reason", "unimplemented_status");
				span.end();
				this.stop();
				return;
			}

			this.isProcessing = false;
		} catch (error) {
			this.retries++;
			const err = error instanceof Error ? error : new Error(String(error));
			logger.warn(`Processing error for DR ${this.drId} (attempt ${this.retries}): ${err.message}`, {
				id: this.name,
			});

			if (this.retries >= (this.appConfig.sedaChain?.maxRetries || 3)) {
				logger.error(`Max retries reached for DR ${this.drId}, marking as failed`, {
					id: this.name,
				});
				this.stop();
				return;
			}

			// 🚀 PERFORMANCE: Fast retry with minimal backoff
			const backoffDelay = Math.min(100 * Math.pow(1.5, this.retries - 1), 2000); // Cap at 2 seconds
			await sleep(backoffDelay);
		} finally {
			this.isProcessing = false;
			span.end();
		}

		// Continue processing if we haven't finished
		if (this.status !== IdentityDataRequestStatus.Revealed) {
			// 🚀 PERFORMANCE: Use setTimeout(0) to prevent stack overflow while maintaining responsiveness
			setTimeout(() => this.process(), 0);
		}
	}

	async handleRefreshDataRequestData(drId: string) {
		// When using block monitoring, we don't need to refresh data request data via RPC
		// as all state changes are handled by block events
		if (this.blockMonitor) {
			logger.debug("Skipping data request refresh - using block monitoring for state updates", {
				id: this.name,
			});
			return;
		}

		const span = this.drTracer.startSpan("refresh-data-request", undefined, this.rootContext);
		span.setAttribute("dr_id", this.drId);
		span.setAttribute("identity_id", this.identityId);
		span.setAttribute("current_status", this.status);

		logger.debug(`🔄 Fetching latest info (status: ${this.status})...`, {
			id: this.name,
		});

		const result = await getDataRequest(drId, this.sedaChain);

		if (result.isErr) {
			logger.error(`Error while fetching data request: ${result.error}`, {
				id: this.drId,
			});
			span.recordException(result.error);
			span.setAttribute("error", "fetch_failed");

			this.retries += 1;
			const sleepSpan = this.drTracer.startSpan(
				"sleep-between-retries",
				undefined,
				trace.setSpan(context.active(), span),
			);
			sleepSpan.setAttribute("sleep_time", this.appConfig.sedaChain.sleepBetweenFailedTx);
			await sleep(this.appConfig.sedaChain.sleepBetweenFailedTx);
			sleepSpan.end();
			span.end();
			return;
		}

		if (result.value.isNothing) {
			logger.debug("Data Request not found on chain, deleting from pool - likely resolved", {
				id: this.name,
			});
			span.setAttribute("status", "resolved");
			this.pool.deleteDataRequest(drId);
			span.end();
			this.stop();
			return;
		}

		this.pool.insertDataRequest(result.value.value);
		span.end();
	}

	async handleExecution(dataRequest: DataRequest) {
		const span = this.drTracer.startSpan("execute-data-request", undefined, this.rootContext);
		span.setAttribute("dr_id", this.drId);
		span.setAttribute("identity_id", this.identityId);

		logger.info("💫 Executing..", {
			id: this.name,
		});

		const dr = this.pool.getDataRequest(this.drId);
		const info = this.identitityPool.getIdentityInfo(this.identityId);

		if (dr.isNothing) {
			logger.error("Invariant found, data request task uses a data request that does not exist", {
				id: this.name,
			});
			span.setAttribute("error", "data_request_not_found");
			span.end();
			this.stop();
			return;
		}

		if (info.isNothing) {
			logger.error("Invariant found, data request task uses an identity that does not exist", {
				id: this.name,
			});
			span.setAttribute("error", "identity_not_found");
			span.end();
			this.stop();
			return;
		}

		const vmResult = await executeDataRequest(
			info.value.privateKey,
			dataRequest,
			this.eligibilityHeight,
			this.appConfig,
			this.sedaChain,
			this.executeWorkerPool,
			this.compilerWorkerPool,
			this.syncExecuteWorker,
		);

		if (vmResult.isErr) {
			this.retries += 1;
			logger.error(`Error while executing: ${vmResult.error}`, {
				id: this.name,
			});
			span.recordException(vmResult.error);
			span.setAttribute("error", "execution_failed");
			span.end();
			return;
		}

		if (this.appConfig.node.debug) {
			logger.debug(`Raw results: ${JSONStringify(vmResult.value)}`, {
				id: this.name,
			});
		}

		// Check if reveal is too large.
		const maxRevealSize = Math.floor(DEFAULT_MAX_REVEAL_SIZE / dataRequest.replicationFactor);
		let reveal = Buffer.from(vmResult.value.result ?? []);
		let exitCode = vmResult.value.exitCode;
		let stderr = vmResult.value.stderr;

		const revealSize = reveal.byteLength;
		if (revealSize > maxRevealSize) {
			const errMsg = `Reveal size ${revealSize} bytes exceeds the limit ${maxRevealSize} bytes`;
			reveal = Buffer.from([]);
			exitCode = EXECUTION_EXIT_CODE_RESULT_TOO_LARGE;
			stderr = `${errMsg}\n${stderr}`;

			logger.error(errMsg, {
				id: this.name,
			});
			span.setAttribute("error", "reveal_too_large");
			span.setAttribute("reveal_size", revealSize);
			span.setAttribute("max_size", maxRevealSize);
		}

		this.executionResult = Maybe.just<ExecutionResult>({
			stderr: [stderr],
			stdout: [vmResult.value.stdout],
			revealBody: {
				exit_code: exitCode,
				gas_used: vmResult.value.gasUsed,
				dr_id: this.drId,
				dr_block_height: Number(dr.value.height),
				proxy_public_keys: vmResult.value.usedProxyPublicKeys,
				reveal: reveal,
			},
		});

		// 🚀 TIMING: Record execution completion in state manager  
		if (this.blockMonitor && this.executionResult.isJust) {
			const stateManager = (this.blockMonitor as any).stateManager;  
			if (stateManager && typeof stateManager.addExecutionResult === 'function') {
				stateManager.addExecutionResult(this.drId, this.identityId, this.executionResult.value);
			}
		}

		span.setAttribute("gas_used", vmResult.value.gasUsed.toString());
		span.setAttribute("exit_code", exitCode);
		span.setAttribute("reveal_size", reveal.byteLength);
		span.setAttribute("proxy_keys_used", vmResult.value.usedProxyPublicKeys.length);
		span.setAttribute("stderr", stderr);
		span.setAttribute("stdout", vmResult.value.stdout);

		this.transitionStatus(IdentityDataRequestStatus.Executed);
		logger.info("💫 Executed Data Request", {
			id: this.name,
		});
		span.end();
	}

	async handleCommit(dataRequest: DataRequest) {
		const span = this.drTracer.startSpan("commit-data-request", undefined, this.rootContext);
		span.setAttribute("dr_id", this.drId);
		span.setAttribute("identity_id", this.identityId);

		logger.info("📩 Committing...", {
			id: this.name,
		});

		if (this.executionResult.isNothing) {
			logger.error("No execution result available while trying to commit, switching status back to initial");
			span.setAttribute("error", "no_execution_result");
			span.end();
			this.transitionStatus(IdentityDataRequestStatus.EligibleForExecution);
			return;
		}

		const result = await commitDr(
			this.identityId,
			dataRequest,
			this.executionResult.value,
			this.identitityPool,
			this.sedaChain,
			this.appConfig,
		);

		if (result.isErr) {
			if (result.error instanceof AlreadyCommitted) {
				logger.warn("RPC returned AlreadyCommitted. Moving to next stage with possibility of failing..", {
					id: this.name,
				});
				span.setAttribute("status", "already_committed");
				span.recordException(result.error);
				span.end();
				this.transitionStatus(IdentityDataRequestStatus.Committed);
				return;
			}

			if (result.error instanceof DataRequestExpired) {
				logger.warn("Data request was expired", {
					id: this.name,
				});
				span.setAttribute("error", "data_request_expired");
				span.recordException(result.error);
				span.end();
				this.stop();
				return;
			}

			if (result.error instanceof DataRequestNotFound) {
				logger.warn("Data request was not found while committing", {
					id: this.name,
				});
				span.setAttribute("error", "data_request_not_found");
				span.end();
				this.stop();
				return;
			}

			if (result.error instanceof RevealStarted) {
				logger.warn("Reveal stage has started, cannot commit", {
					id: this.name,
				});
				span.setAttribute("error", "reveal_started");
				span.recordException(result.error);
				span.end();
				this.stop();
				return;
			}

			logger.error(`Failed to commit: ${result.error}`, {
				id: this.name,
			});
			span.recordException(result.error);
			span.setAttribute("error", "commit_failed");
			const sleepSpan = this.drTracer.startSpan(
				"sleep-between-retries",
				undefined,
				trace.setSpan(context.active(), span),
			);
			sleepSpan.setAttribute("sleep_time", this.appConfig.sedaChain.sleepBetweenFailedTx);
			await sleep(this.appConfig.sedaChain.sleepBetweenFailedTx);
			sleepSpan.end();
			this.retries += 1;
			span.end();
			return;
		}

		this.transitionStatus(IdentityDataRequestStatus.Committed);
		this.commitHash = result.value;
		
		// 🚀 TIMING: Record commit submission in state manager
		if (this.blockMonitor) {
			const stateManager = (this.blockMonitor as any).stateManager;
			if (stateManager && typeof stateManager.addCommitHash === 'function') {
				stateManager.addCommitHash(this.drId, this.identityId, this.commitHash.toString('hex'));
			}
		}

		logger.info("📩 Committed", {
			id: this.name,
		});
		span.end();
	}

	async handleCheckReadyToBeRevealed(drId: string) {
		// Legacy method only used when block monitoring is disabled
		if (this.blockMonitor) {
			logger.error("handleCheckReadyToBeRevealed should never be called when using block monitoring", {
				id: this.name,
			});
			return;
		}

		const span = this.drTracer.startSpan("check-ready-for-reveal", undefined, this.rootContext);
		span.setAttribute("dr_id", this.drId);
		span.setAttribute("identity_id", this.identityId);

		logger.debug(`Using legacy RPC polling for reveal readiness detection`, {
			id: this.name,
		});
		
		await this.handleRefreshDataRequestData(drId);

		const dataRequest = this.pool.getDataRequest(drId);

		// Rest will be handled by the process() function
		if (dataRequest.isNothing) {
			span.setAttribute("status", "data_request_not_found");
			span.end();
			return;
		}

		if (!isDrInRevealStage(dataRequest.value)) {
			span.setAttribute("status", "not_ready_for_reveal");
			const sleepSpan = this.drTracer.startSpan(
				"sleep-waiting-for-reveal",
				undefined,
				trace.setSpan(context.active(), span),
			);
			sleepSpan.setAttribute("sleep_time", this.appConfig.intervals.statusCheck);
			await sleep(this.appConfig.intervals.statusCheck);
			sleepSpan.end();
			span.end();
			return;
		}

		span.setAttribute("status", "ready_for_reveal");
		this.transitionStatus(IdentityDataRequestStatus.ReadyToBeRevealed);
		span.end();
	}

	async handleReveal(_dataRequest: DataRequest) {
		const span = this.drTracer.startSpan("reveal-data-request", undefined, this.rootContext);
		span.setAttribute("dr_id", this.drId);
		span.setAttribute("identity_id", this.identityId);

		logger.info("📨 Revealing... (status transition triggered reveal)", {
			id: this.name,
		});

		if (this.executionResult.isNothing) {
			logger.error("No execution result available while trying to reveal, switching status back to initial");
			span.setAttribute("error", "no_execution_result");
			span.end();
			this.transitionStatus(IdentityDataRequestStatus.EligibleForExecution);
			return;
		}

		const result = await revealDr(
			this.identityId,
			_dataRequest,
			this.executionResult.value,
			this.identitityPool,
			this.sedaChain,
			this.appConfig,
		);

		if (result.isErr) {
			if (result.error.error instanceof AlreadyRevealed) {
				this.transitionStatus(IdentityDataRequestStatus.Revealed);
				span.setAttribute("status", "already_revealed");

				logger.warn("Chain responded with AlreadyRevealed, updating inner state to reflect", {
					id: this.name,
				});
				span.end();
				return;
			}

			if (result.error.error instanceof RevealMismatch) {
				logger.error(
					`Chain responded with an already revealed. Data might be corrupted: ${this.commitHash.toString("hex")} vs ${result.error.commitmentHash.toString("hex")}`,
				);
				span.setAttribute("error", "reveal_mismatch");
				span.setAttribute("our_commit_hash", this.commitHash.toString("hex"));
				span.setAttribute("chain_commit_hash", result.error.commitmentHash.toString("hex"));
				span.end();
				this.stop();
				return;
			}

			if (result.error.error instanceof DataRequestNotFound) {
				logger.warn("Data request was not found while resolving reveal", {
					id: this.name,
				});
				span.setAttribute("error", "data_request_not_found");
				span.end();
				this.stop();
				return;
			}

			if (result.error instanceof DataRequestExpired) {
				logger.warn("Data request was expired", {
					id: this.name,
				});
				span.setAttribute("error", "data_request_expired");
				span.end();
				this.stop();
				return;
			}

			span.recordException(result.error.error);
			span.setAttribute("error", "reveal_failed");
			const sleepSpan = this.drTracer.startSpan(
				"sleep-between-retries",
				undefined,
				trace.setSpan(context.active(), span),
			);
			sleepSpan.setAttribute("sleep_time", this.appConfig.sedaChain.sleepBetweenFailedTx);
			await sleep(this.appConfig.sedaChain.sleepBetweenFailedTx);
			sleepSpan.end();
			this.retries += 1;
			span.end();
			return;
		}

		// Transaction submitted successfully - add reveal hash to block monitor for tracking
		if (this.blockMonitor) {
			this.blockMonitor.addRevealHash(this.drId, this.identityId, result.value.toString("hex"));
			logger.info(`📝 Notified block monitor of our reveal transaction for DR ${this.drId}`, {
				id: this.name,
			});
			
			// 🚀 TIMING: Record reveal submission in state manager
			const stateManager = (this.blockMonitor as any).stateManager;
			if (stateManager && typeof stateManager.addRevealHash === 'function') {
				stateManager.addRevealHash(this.drId, this.identityId, result.value.toString("hex"));
			}
			
			// Mark that we've submitted the reveal to avoid duplicate submissions
			this.revealSubmitted = true;
			
			// Don't transition to Revealed yet - wait for block monitor to confirm reveal on-chain
			// Stay in ReadyToBeRevealed status until reveal is confirmed
			span.setAttribute("status", "reveal_transaction_submitted");
			logger.info("📨 Reveal transaction submitted, waiting for on-chain confirmation", {
				id: this.name,
			});
		} else {
			// Legacy mode - immediately mark as revealed (old behavior)
			this.transitionStatus(IdentityDataRequestStatus.Revealed);
			span.setAttribute("status", "revealed");
			logger.info("📨 Revealed (legacy mode)", {
				id: this.name,
			});
		}
		span.end();
	}
}
