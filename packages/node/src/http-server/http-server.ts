import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Hono } from "hono";

export function startHttpServer(appConfig: AppConfig) {
	const app = new Hono()

	app.get('/healthz', (c) => c.text('ok'));
	app.get('/readyz', (c) => c.text('ok'));

	if (typeof Bun !== "undefined") {
		const server = Bun.serve({
			fetch: app.fetch,
			port: appConfig.httpServer.port,
		});

		logger.info(`HTTP server started on ${server.url}`);
	} else {
		// We can always add node.js support later through the @hono/node-server package
		logger.error("HTTP server is not supported in this environment");
		process.exit(1);
	}
}