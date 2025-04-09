import {
	AlreadyCommitted,
	AlreadyRevealed,
	DataRequestExpired,
	JSONStringify,
	RevealMismatch,
	debouncedInterval,
	sleep,
} from "@sedaprotocol/overlay-ts-common";
import type { SedaChain, WorkerPool } from "@sedaprotocol/overlay-ts-common";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { EventEmitter } from "eventemitter3";
import { Maybe } from "true-myth";
import { type DataRequest, isDrInRevealStage } from "./models/data-request";
import { type DataRequestPool, IdentityDataRequestStatus } from "./models/data-request-pool";
import type { ExecutionResult } from "./models/execution-result";
import type { IdentityPool } from "./models/identitiest-pool";
import { getDataRequest } from "./services/get-data-requests";
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

	constructor(
		private pool: DataRequestPool,
		private identitityPool: IdentityPool,
		private appConfig: AppConfig,
		private sedaChain: SedaChain,
		private drId: string,
		private identityId: string,
		private executeWorkerPool: Maybe<WorkerPool>,
		private compilerWorkerPool: Maybe<WorkerPool>,
	) {
		super();

		this.name = `${drId}_${identityId}`;
	}

	private transitionStatus(toStatus: IdentityDataRequestStatus) {
		this.retries = 0;
		this.status = toStatus;
		this.pool.insertIdentityDataRequest(this.drId, this.identityId, Maybe.nothing(), toStatus);
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

		this.emit("done");
	}

	public start() {
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
	}

	async process(): Promise<void> {
		try {
			if (this.isProcessing) {
				logger.debug(`Already processing, skipping while on status: ${this.status}`, {
					id: this.name,
				});
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

				this.stop();
				return;
			}

			// Check if we've exceeded retry limit
			if (this.retries > this.appConfig.sedaChain.maxRetries) {
				logger.error("Exceeded maximum retry attempts, marking data request as failed", {
					id: this.name,
				});
				this.status = IdentityDataRequestStatus.Failed;
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
				this.stop();
				return;
			} else {
				logger.error(`Unimplemented status ${this.status}, aborting data-request`, {
					id: this.name,
				});
				this.stop();
				return;
			}

			this.isProcessing = false;
		} catch (error) {
			logger.error(`Error while processing data request: ${error}`, {
				id: this.name,
			});
		} finally {
			this.isProcessing = false;
		}
	}

	async handleRefreshDataRequestData(drId: string) {
		logger.debug(`🔄 Fetching latest info (status: ${this.status})...`, {
			id: this.name,
		});

		const result = await getDataRequest(drId, this.sedaChain);

		if (result.isErr) {
			logger.error(`Error while fetching data request: ${result.error}`, {
				id: this.drId,
			});

			this.retries += 1;
			await sleep(this.appConfig.sedaChain.sleepBetweenFailedTx);
			return;
		}

		if (result.value.isNothing) {
			this.pool.deleteDataRequest(drId);
			this.stop();
			return;
		}

		this.pool.insertDataRequest(result.value.value);
	}

	async handleExecution(dataRequest: DataRequest) {
		logger.info("💫 Executing..", {
			id: this.name,
		});

		const dr = this.pool.getDataRequest(this.drId);
		const info = this.identitityPool.getIdentityInfo(this.identityId);

		if (dr.isNothing) {
			logger.error("Invariant found, data request task uses a data request that does not exist", {
				id: this.name,
			});
			this.stop();
			return;
		}

		if (info.isNothing) {
			logger.error("Invariant found, data request task uses an identity that does not exist", {
				id: this.name,
			});
			this.stop();
			return;
		}

		const vmResult = await executeDataRequest(
			info.value.privateKey,
			dataRequest,
			this.appConfig,
			this.sedaChain,
			this.executeWorkerPool,
			this.compilerWorkerPool,
		);

		if (vmResult.isErr) {
			this.retries += 1;
			logger.error(`Error while executing: ${vmResult.error}`, {
				id: this.name,
			});

			return;
		}

		logger.debug(`Raw results: ${JSONStringify(vmResult.value)}`, {
			id: this.name,
		});

		this.executionResult = Maybe.just<ExecutionResult>({
			stderr: [vmResult.value.stderr],
			stdout: [vmResult.value.stdout],
			revealBody: {
				exit_code: vmResult.value.exitCode,
				gas_used: vmResult.value.gasUsed,
				dr_id: this.drId,
				dr_block_height: Number(dr.value.height),
				proxy_public_keys: vmResult.value.usedProxyPublicKeys,
				reveal: Buffer.from(vmResult.value.result ?? []),
			},
		});

		this.transitionStatus(IdentityDataRequestStatus.Executed);
		logger.info("💫 Executed Data Request", {
			id: this.name,
		});
	}

	async handleCommit(dataRequest: DataRequest) {
		logger.info("📩 Committing...", {
			id: this.name,
		});

		if (this.executionResult.isNothing) {
			logger.error("No execution result available while trying to commit, switching status back to initial");
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

				this.transitionStatus(IdentityDataRequestStatus.Committed);
				return;
			}

			if (result.error instanceof DataRequestExpired) {
				logger.warn("Data request was expired", {
					id: this.name,
				});
				this.stop();
				return;
			}

			logger.error(`Failed to commit: ${result.error}`, {
				id: this.name,
			});

			await sleep(this.appConfig.sedaChain.sleepBetweenFailedTx);
			this.retries += 1;
			return;
		}

		this.transitionStatus(IdentityDataRequestStatus.Committed);
		this.commitHash = result.value;
		logger.info("📩 Committed", {
			id: this.name,
		});
	}

	async handleCheckReadyToBeRevealed(drId: string) {
		await this.handleRefreshDataRequestData(drId);

		const dataRequest = this.pool.getDataRequest(drId);

		// Rest will be handled by the process() function
		if (dataRequest.isNothing) {
			return;
		}

		if (!isDrInRevealStage(dataRequest.value)) {
			await sleep(this.appConfig.intervals.statusCheck);
			return;
		}

		this.transitionStatus(IdentityDataRequestStatus.ReadyToBeRevealed);
	}

	// TODO: check if we remove the dataRequest parameter
	async handleReveal(_dataRequest: DataRequest) {
		logger.info("📨 Revealing...", {
			id: this.name,
		});

		if (this.executionResult.isNothing) {
			logger.error("No execution result available while trying to reveal, switching status back to initial");
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

				logger.warn("Chain responded with AlreadyRevealed, updating inner state to reflect", {
					id: this.name,
				});
				return;
			}

			if (result.error.error instanceof RevealMismatch) {
				logger.error(
					`Chain responded with an already revealed. Data might be corrupted: ${this.commitHash.toString("hex")} vs ${result.error.commitmentHash.toString("hex")}`,
				);
			}

			if (result.error instanceof DataRequestExpired) {
				logger.warn("Data request was expired", {
					id: this.name,
				});
				this.stop();
				return;
			}

			await sleep(this.appConfig.sedaChain.sleepBetweenFailedTx);
			this.retries += 1;
			return;
		}

		this.transitionStatus(IdentityDataRequestStatus.Revealed);
		logger.info("📨 Revealed", {
			id: this.name,
		});
	}
}
