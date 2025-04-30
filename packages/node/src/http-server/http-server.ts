import { serve } from "@hono/node-server";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Hono } from "hono";
import type { MainTask } from "../tasks/main";
import { createApi } from "./routes/api";

export function startHttpServer(appConfig: AppConfig, mainTask: MainTask) {
	const app = new Hono();

	// Healthcheck endpoints
	app.get("/healthz", (c) => c.text("ok"));
	app.get("/readyz", (c) => c.text("ok"));

	app.route("/api", createApi(mainTask));

	if (typeof Bun !== "undefined") {
		const server = Bun.serve({
			fetch: app.fetch,
			port: appConfig.httpServer.port,
		});

		logger.info(`HTTP server started on ${server.url}`);
	} else {
		serve(
			{
				fetch: app.fetch,
				port: appConfig.httpServer.port,
			},
			(info) => {
				logger.info(`${info.family} HTTP server started on ${info.address}${info.port}`);
			},
		);
	}
}
