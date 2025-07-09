import { Worker } from "node:worker_threads";

type WorkerInfo = {
	id: number;
	worker: Worker;
	isRunning: boolean;
};

type Task<T = void> = (worker: Worker) => Promise<T>;

export class WorkerPool {
	private runningTasks: Map<number, Promise<unknown>> = new Map();
	public pool: WorkerInfo[] = [];
	// Using round-robin to pick workers for parallel data request execution.
	// More efficient than picking the first available worker since workers spend lots of time waiting on HTTP calls.
	// TODO: Could make this smarter by picking workers that are actually free.
	private index = 0;

	constructor(
		private workerSrcUrl: string,
		private amount: number,
		private terminateAfterCompletion = false,
	) {
		for (let i = 0; i < this.amount; i++) {
			this.pool.push({
				id: i,
				worker: new Worker(this.workerSrcUrl),
				isRunning: false,
			});
		}
	}

	private async getAvailableWorker(): Promise<WorkerInfo> {
		const workerIndex = this.index % this.pool.length;
		const worker = this.pool[workerIndex];
		this.index += 1;
		worker.isRunning = true;
		return worker;
	}

	async executeTask<T>(task: Task<T>): Promise<T> {
		const workerInfo = await this.getAvailableWorker();

		const workerPromise = new WorkerPromise();
		const taskPromise = task(workerInfo.worker).catch((error) => {
			// Ensure errors are propagated
			workerInfo.isRunning = false;
			this.runningTasks.delete(workerInfo.id);
			throw error;
		});

		this.runningTasks.set(workerInfo.id, workerPromise.promise);

		try {
			return await taskPromise;
		} finally {
			if (this.terminateAfterCompletion) {
				await workerInfo.worker.terminate();

				// Create a new worker with same ID
				const newWorker = new Worker(this.workerSrcUrl);
				workerInfo.worker = newWorker;
			}

			this.runningTasks.delete(workerInfo.id);
			workerInfo.isRunning = false;

			workerPromise.resolve();
		}
	}
}

/**
 * We need to separate the task promise from the worker promise
 * so we can fully clean up the worker and task before we make the
 * worker available again to the pool.
 */
class WorkerPromise {
	public promise: Promise<void>;
	private resolver!: () => void;

	constructor() {
		this.promise = new Promise((resolve) => {
			this.resolver = resolve;
		});
	}

	resolve() {
		this.resolver();
	}
}
