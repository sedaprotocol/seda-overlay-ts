import { SedaChain, isBun } from "@sedaprotocol/overlay-ts-common";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import semver from "semver";
import { Maybe } from "true-myth";
import { version } from "../../../package.json";
import { MIN_MAJOR_NODE_VERSION } from "./constants";
import { startHttpServer } from "./http-server";
import { MainTask } from "./tasks/main";

export interface RunOptions {
	exitController?: AbortController;
}

export async function runNode(appConfig: AppConfig, runOptions?: RunOptions) {
	logger.info(`Overlay Node v${version} is starting..`);
	const exitController = Maybe.of(runOptions?.exitController);
	const sedaChain = await SedaChain.fromConfig(appConfig);

	if (sedaChain.isErr) {
		logger.error(`${sedaChain.error}`);
		process.exit(1);
	}

	if (isBun()) {
		logger.info(`Running on Bun v${Bun.version}`);
	} else {
		const nodeVersion = semver.parse(process.version);

		if (nodeVersion?.major && nodeVersion.major < MIN_MAJOR_NODE_VERSION) {
			logger.warn(`Overlay Node was tested with Node.js v${MIN_MAJOR_NODE_VERSION} or higher`);
			logger.warn("This may cause unexpected behavior");
		}

		logger.info(`Running on Node.js ${process.version}`);
	}

	logger.info(`Talking to RPC: ${appConfig.sedaChain.rpc}`);
	logger.info(`Using chain ID: ${appConfig.sedaChain.chainId}`);
	logger.info(`Using SEDA address: ${sedaChain.value.getSignerAddress()}`);

	sedaChain.value.start();

	const mainTask = new MainTask(appConfig, sedaChain.value);
	mainTask.start();

	startHttpServer(appConfig, mainTask);

	if (exitController.isJust) {
		exitController.value.signal.addEventListener("abort", () => {
			logger.warn("Abort signal received. Stopping gracefully..");

			mainTask.stop();
			sedaChain.value.stop();

			process.exit(1);
		});
	}
}

// Exports for testing purposes
export { DataRequestPool } from "./models/data-request-pool";
export { IdentityPool } from "./models/identitiest-pool";
export type { DataRequest } from "./models/data-request";