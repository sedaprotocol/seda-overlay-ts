import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { Hono } from "hono";
import type { MainTask } from "../../tasks/main";

export function createApi(appConfig: AppConfig, mainTask: MainTask) {
	const api = new Hono();

	api.get("/health", (c) => {
		const includePool = typeof c.req.query("includePool") !== "undefined";

		const pool = includePool
			? {
					dataRequestsInPool: Array.from(mainTask.pool.allDataRequests()).map((dr) => dr.id),
					executingDataRequests: Array.from(mainTask.pool.allIdentityDataRequests()).map(
						({ drId, identityId, status }) => ({
							identityId,
							status,
							dataRequest: drId,
						}),
					),
				}
			: undefined;

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

			pool,

			version: appConfig.version,
			vmVersion: appConfig.vmVersion,
		});
	});

	return api;
}
