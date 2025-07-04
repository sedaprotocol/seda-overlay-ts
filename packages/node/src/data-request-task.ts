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
	metricsHelpers,
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
import { getDataRequestStatuses } from "./services/get-data-requests";
import { protocolPauseState } from "./services/is-protocol-paused";
import { commitDr } from "./tasks/commit";
import { executeDataRequest } from "./tasks/execute";
import { revealDr } from "./tasks/reveal";

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
	private drTracer: Tracer;
	private rootSpan: Span;
	private rootContext: ReturnType<typeof context.active>;

	constructor(
		private pool: DataRequestPool,
		private identitityPool: IdentityPool,
		private appConfig: AppConfig,
		private sedaChain: SedaChain,
		public drId: string,
		private identityId: string,
		private eligibilityHeight: bigint,
		private executeWorkerPool: Maybe<WorkerPool>,
		private compilerWorkerPool: Maybe<WorkerPool>,
		private syncExecuteWorker: Maybe<WorkerPool>,
	) {
		super();

		this.name = `${drId}_${identityId}`;
		this.drTracer = trace.getTracer("data-request-task");
		this.rootSpan = this.drTracer.startSpan("data-request-lifecycle");
		this.rootContext = trace.setSpan(context.active(), this.rootSpan);
		this.rootSpan.setAttribute("dr_id", this.drId);
		this.rootSpan.setAttribute("identity_id", this.identityId);
		this.rootSpan.setAttribute("start_time", new Date().toISOString());
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

	public start() {
		const span = this.drTracer.startSpan("start-data-request", undefined, this.rootContext);
		span.setAttribute("dr_id", this.drId);
		span.setAttribute("identity_id", this.identityId);

		logger.trace("Starting data request task", {
			id: this.name,
		});

		this.refreshDataRequestDataIntervalId = Maybe.of(
			debouncedInterval(async () => {
				await this.handleRefreshDataRequestData(this.drId);
			}, this.appConfig.intervals.statusCheck),
		);

		// It seems like doing an interval is much more stable than recursively calling this.process()
		// Also because it's more friendly with JS event loop
		this.executeDrIntervalId = Maybe.of(
			debouncedInterval(async () => {
				await this.process();
			}, this.appConfig.intervals.drTask),
		);

		span.end();
	}

	async process(): Promise<void> {
		if (protocolPauseState.isPaused()) {
			return;
		}

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

				// Record high-priority RPC connectivity error
				const retryError = new Error(`Exceeded maximum retry attempts: ${this.retries}`);
				metricsHelpers.recordRpcError("data_request", "max_retries_exceeded", retryError, {
					dr_id: this.drId,
					identity_id: this.identityId,
					retries: this.retries.toString(),
				});

				this.status = IdentityDataRequestStatus.Failed;
				span.setAttribute("final_status", "failed");
				span.setAttribute("failure_reason", "max_retries_exceeded");
				span.end();
				this.stop();
				return;
			}

			if (this.status === IdentityDataRequestStatus.EligibleForExecution) {
				await this.handleExecution(dataRequest.value);
			} else if (this.status === IdentityDataRequestStatus.Executed) {
				await this.handleCommit(dataRequest.value);
			} else if (this.status === IdentityDataRequestStatus.Committed) {
				await this.handleCheckReadyToBeRevealed(dataRequest.value.id);
			} else if (this.status === IdentityDataRequestStatus.ReadyToBeRevealed) {
				await this.handleReveal(dataRequest.value);
			} else if (this.status === IdentityDataRequestStatus.Revealed) {
				span.setAttribute("final_status", "revealed");
				span.end();
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
			logger.error(`Error while processing data request: ${error}`, {
				id: this.name,
			});

			// Record high-priority RPC connectivity error
			metricsHelpers.recordRpcError("data_request", "uncaught_exception", error as Error, {
				dr_id: this.drId,
				identity_id: this.identityId,
				status: this.status,
				retries: this.retries.toString(),
			});

			span.recordException(error as Error);
			span.setAttribute("final_status", "error");
			span.setAttribute("error_reason", "uncaught_exception");
		} finally {
			this.isProcessing = false;
			span.end();
		}
	}

	async handleRefreshDataRequestData(drId: string) {
		if (protocolPauseState.isPaused()) {
			return;
		}

		const span = this.drTracer.startSpan("refresh-data-request", undefined, this.rootContext);
		span.setAttribute("dr_id", this.drId);
		span.setAttribute("identity_id", this.identityId);
		span.setAttribute("current_status", this.status);

		logger.debug(`🔄 Fetching latest info (status: ${this.status})...`, {
			id: this.name,
		});

		const statusResult = await getDataRequestStatuses(this.sedaChain, drId);

		if (statusResult.isErr) {
			logger.error(`Error while fetching status of data request: ${statusResult.error}`, {
				id: this.drId,
			});

			// Record high-priority RPC connectivity error
			metricsHelpers.recordRpcError("data_request", "status_fetch", statusResult.error, {
				dr_id: this.drId,
				identity_id: this.identityId,
				retries: this.retries.toString(),
			});

			span.recordException(statusResult.error);
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

		if (statusResult.value.isNothing) {
			logger.debug("Data Request not found on chain, deleting from pool - likely resolved", {
				id: this.name,
			});
			span.setAttribute("status", "resolved");
			this.pool.deleteDataRequest(drId);
			span.end();
			this.stop();
			return;
		}

		this.pool.updateDataRequestStatus(drId, statusResult.value.value);
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

			// CRITICAL: State Invariant Violation - Missing Data Request
			const stateError = new Error("Data request task references non-existent data request");
			metricsHelpers.recordCriticalError("state_invariant", stateError, {
				type: "missing_data_request",
				dr_id: this.drId,
				identity_id: this.identityId,
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

			// CRITICAL: State Invariant Violation - Missing Identity
			const stateError = new Error("Data request task references non-existent identity");
			metricsHelpers.recordCriticalError("state_invariant", stateError, {
				type: "missing_identity",
				dr_id: this.drId,
				identity_id: this.identityId,
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

			// HIGH: Execution result missing - should not be possible
			const missingResultError = new Error("Execution result missing during commit phase");
			metricsHelpers.recordHighPriorityError("execution_result_missing", missingResultError, {
				phase: "commit",
				dr_id: this.drId,
				identity_id: this.identityId,
			});

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
		span.setAttribute("commit_hash", result.value.toString("hex"));
		logger.info("📩 Committed", {
			id: this.name,
		});
		span.end();
	}

	async handleCheckReadyToBeRevealed(drId: string) {
		const span = this.drTracer.startSpan("check-ready-for-reveal", undefined, this.rootContext);
		span.setAttribute("dr_id", this.drId);
		span.setAttribute("identity_id", this.identityId);

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

		logger.info("📨 Revealing...", {
			id: this.name,
		});

		if (this.executionResult.isNothing) {
			logger.error("No execution result available while trying to reveal, switching status back to initial");

			// HIGH: Execution result missing - should not be possible
			const missingResultError = new Error("Execution result missing during reveal phase");
			metricsHelpers.recordHighPriorityError("execution_result_missing", missingResultError, {
				phase: "reveal",
				dr_id: this.drId,
				identity_id: this.identityId,
			});

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

				// CRITICAL: Duplicate Node Detection - Reveal hash mismatch indicates duplicate nodes
				const duplicateError = new Error("Reveal hash mismatch - possible duplicate nodes");
				metricsHelpers.recordCriticalError("duplicate_node", duplicateError, {
					type: "reveal_hash_mismatch",
					dr_id: this.drId,
					identity_id: this.identityId,
					our_commit_hash: this.commitHash.toString("hex"),
					chain_commit_hash: result.error.commitmentHash.toString("hex"),
				});

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

		this.transitionStatus(IdentityDataRequestStatus.Revealed);
		span.setAttribute("status", "revealed");
		logger.info("📨 Revealed", {
			id: this.name,
		});
		span.end();
	}
}
