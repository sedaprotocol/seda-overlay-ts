import { serve } from "@hono/node-server";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import getPort, { portNumbers } from "get-port";
import { Hono } from "hono";
import type { MainTask } from "../tasks/main";
import { createApi } from "./routes/api";

export async function startHttpServer(appConfig: AppConfig, mainTask: MainTask) {
	const app = new Hono();

	// Healthcheck endpoints
	app.get("/healthz", (c) => c.text("ok"));
	app.get("/readyz", (c) => c.text("ok"));

	app.route("/api", createApi(appConfig, mainTask));

	let port = appConfig.httpServer.port;

	if (appConfig.httpServer.enableAutoPortDiscovery) {
		port = await getPort({ port: portNumbers(appConfig.httpServer.port, appConfig.httpServer.port + 100) });

		if (port !== appConfig.httpServer.port) {
			logger.warn(`HTTP Port ${appConfig.httpServer.port} is already in use. Switching to ${port}`);
		}
	}

	if (typeof Bun !== "undefined") {
		const server = Bun.serve({
			fetch: app.fetch,
			port,
		});

		logger.info(`HTTP server started on ${server.url}`);
	} else {
		serve(
			{
				fetch: app.fetch,
				port,
			},
			(info) => {
				logger.info(`${info.family} HTTP server started on ${info.address}${info.port}`);
			},
		);
	}
}
