import { Hono } from "hono";
import type { MainTask } from "../../tasks/main";

export function createApi(mainTask: MainTask) {
	const api = new Hono();

	api.get("/health", (c) => {
		return c.json({
			activelyExecutingSize: mainTask.activeDataRequestTasks,
			eligibleButWaitingForExecutionSize: mainTask.dataRequestsToProcess.length,
			dataRequestPoolSize: mainTask.pool.size,
			completedDataRequests: mainTask.completedDataRequests,

			txStats: mainTask.getTransactionStats(),

			isFetchTaskHealthy: mainTask.isFetchTaskHealthy(),

			activeIdentities: Array.from(mainTask.identityPool.all()).map(({ identityId, enabled }) => ({
				identityId,
				enabled,
			})),

			pool: {
				dataRequestsInPool: Array.from(mainTask.pool.allDataRequests()).map((dr) => dr.id),
				executingDataRequests: Array.from(mainTask.pool.allIdentityDataRequests()).map(
					({ drId, identityId, status }) => ({
						identityId,
						status,
						dataRequest: drId,
					}),
				),
			},
		});
	});

	return api;
}
