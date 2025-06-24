import { Hono } from "hono";
import type { MainTask } from "../../tasks/main";
import { getRpcMetrics } from "../../internal-metrics";
import { match } from "ts-pattern";

export function createApi(mainTask: MainTask) {
	const api = new Hono();

	api.get("/health", (c) => {
		const rpcAggregation = match(c.req.query("rpcFilter"))
			.with("avg", () => "avg" as const)
			.with("all", () => "all" as const)
			.otherwise(() => "avg" as const);

		return c.json({
			activelyExecutingSize: mainTask.activeDataRequestTasks,
			eligibleButWaitingForExecutionSize: mainTask.dataRequestsToProcess.length,
			dataRequestPoolSize: mainTask.pool.size,
			completedDataRequests: mainTask.completedDataRequests,

			txStats: mainTask.getTransactionStats(),

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
			rpcMetrics: getRpcMetrics(rpcAggregation),
		});
	});

	return api;
}
