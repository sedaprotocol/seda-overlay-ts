import { serve } from "@hono/node-server";
import { getRuntime } from "@sedaprotocol/overlay-ts-common";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import getPort, { portNumbers } from "get-port";
import { Hono } from "hono";
import { match } from "ts-pattern";
import type { MainTask } from "../tasks/main";
import { createApi } from "./routes/api";

export async function startHttpServer(appConfig: AppConfig, mainTask: MainTask) {
	const app = new Hono();

	// Healthcheck endpoints
	app.get("/healthz", (c) => c.text("ok"));
	app.get("/readyz", (c) => c.text("ok"));

	app.route("/api", createApi(mainTask));

	let port = appConfig.httpServer.port;

	if (appConfig.httpServer.enableAutoPortDiscovery) {
		port = await getPort({ port: portNumbers(appConfig.httpServer.port, appConfig.httpServer.port + 100) });

		if (port !== appConfig.httpServer.port) {
			logger.warn(`HTTP Port ${appConfig.httpServer.port} is already in use. Switching to ${port}`);
		}
	}

	const runtime = getRuntime();

	match(runtime)
		.with("bun", () => {
			const server = Bun.serve({
				fetch: app.fetch,
				port,
			});

			logger.info(`HTTP server started on ${server.url}`);
		})
		.with("node", () => {
			serve(
				{
					fetch: app.fetch,
					port,
				},
				(info) => {
					logger.info(`${info.family} HTTP server started on ${info.address}${info.port}`);
				},
			);
		})
		.with("deno", () => {
			const server = Deno.serve({ port }, app.fetch);
			logger.info(`HTTP server started on ${server.addr.transport}://${server.addr.hostname}:${server.addr.port}`);
		});
}
