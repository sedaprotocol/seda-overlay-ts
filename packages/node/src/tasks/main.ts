import type { SedaChain } from "@sedaprotocol/overlay-ts-common";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { Maybe } from "true-myth";
import { DataRequestTask } from "../data-request-task";
import { DataRequestPool } from "../models/data-request-pool";
import { IdentityPool } from "../models/identitiest-pool";
import { FetchTask } from "./fetch";
import { IdentityManagerTask } from "./identity-manager";
import { EligibilityTask } from "./is-eligible";

export class MainTask {
	private pool: DataRequestPool = new DataRequestPool();
	private fetchTask: FetchTask;
	private identityManagerTask: IdentityManagerTask;
	private identityPool: IdentityPool;
	private elgibilityTask: EligibilityTask;

	// These are the actual data requests we are currently processing and need to be completed before we move on
	private activeDataRequestTasks = 0;

	// We only want to process as much data requests as the node can handle.
	// That's why we keep track of data requests that we want to process before pushing them to active.
	private dataRequestsToProcess: DataRequestTask[] = [];

	constructor(
		private config: AppConfig,
		private sedaChain: SedaChain,
	) {
		this.identityPool = new IdentityPool(config);

		this.fetchTask = new FetchTask(this.pool, config, sedaChain);
		this.identityManagerTask = new IdentityManagerTask(this.identityPool, config, sedaChain);
		this.elgibilityTask = new EligibilityTask(this.pool, this.identityPool, config, sedaChain);

		setInterval(() => this.processNextDr(), 2500);
	}

	private processNextDr() {
		if (this.activeDataRequestTasks >= this.config.node.maxConcurrentRequests) return;

		const dataRequest = Maybe.of(this.dataRequestsToProcess.shift());
		if (dataRequest.isNothing) return;

		dataRequest.value.on("done", () => {
			this.activeDataRequestTasks -= 1;
			this.processNextDr();
		});

		dataRequest.value.start();
		this.activeDataRequestTasks += 1;
	}

	async start() {
		// There only should be a few tickers, since these tasks are polling the network for status changes
		await this.identityManagerTask.start();
		this.fetchTask.start();

		this.fetchTask.on("data-request", (dataRequest) => {
			this.elgibilityTask.checkEligibility(dataRequest);
		});

		this.elgibilityTask.on("eligible", (drId, identityId) => {
			const drTask = new DataRequestTask(this.pool, this.identityPool, this.config, this.sedaChain, drId, identityId);
			this.dataRequestsToProcess.push(drTask);
			this.processNextDr();
		});
	}

	stop() {
		this.fetchTask.stop();
	}
}
