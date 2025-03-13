import { Worker } from "node:worker_threads";

type WorkerInfo = {
	id: number;
	worker: Worker;
	isRunning: boolean;
};

type Task<T = void> = (worker: Worker) => Promise<T>;

export class WorkerPool {
	private runningTasks: Map<number, Promise<unknown>> = new Map();
	private pool: WorkerInfo[] = [];

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
		// Find first non-running worker
		const availableWorker = this.pool.find((w) => !w.isRunning);
		if (availableWorker) {
			availableWorker.isRunning = true;
			return availableWorker;
		}

		// Wait for any running task to complete
		const runningTaskPromises = Array.from(this.runningTasks.values());
		await Promise.race(runningTaskPromises);

		// Try again after a task completed
		return this.getAvailableWorker();
	}

	async executeTask<T>(task: Task<T>): Promise<T> {
		const workerInfo = await this.getAvailableWorker();

		const taskPromise = task(workerInfo.worker).catch((error) => {
			// Ensure errors are propagated
			workerInfo.isRunning = false;
			this.runningTasks.delete(workerInfo.id);
			throw error;
		});

		this.runningTasks.set(workerInfo.id, taskPromise);

		try {
			return await taskPromise;
		} finally {
			if (this.terminateAfterCompletion) {
				await workerInfo.worker.terminate();
			}

			// Create a new worker with same ID
			const newWorker = new Worker(this.workerSrcUrl);
			workerInfo.worker = newWorker;

			this.runningTasks.delete(workerInfo.id);
			workerInfo.isRunning = false;
		}
	}
}
