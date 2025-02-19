import { SedaChain } from "@sedaprotocol/overlay-ts-common";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Maybe } from "true-myth";
import { MainTask } from "./tasks/main";

export interface RunOptions {
	exitController?: AbortController;
}

export async function runNode(appConfig: AppConfig, runOptions?: RunOptions) {
	logger.info("Node is starting..");

	const exitController = Maybe.of(runOptions?.exitController);
	const sedaChain = await SedaChain.fromConfig(appConfig);

	if (sedaChain.isErr) {
		logger.error(`${sedaChain.error}`);
		process.exit(1);
	}

	logger.info(`Using SEDA address: ${sedaChain.value.getSignerAddress()}`);
	sedaChain.value.start();

	const mainTask = new MainTask(appConfig, sedaChain.value);
	mainTask.start();

	if (exitController.isJust) {
		exitController.value.signal.addEventListener("abort", () => {
			logger.warn("Abort signal received. Stopping gracefully..");

			mainTask.stop();
			sedaChain.value.stop();

			process.exit(1);
		});
	}
}
