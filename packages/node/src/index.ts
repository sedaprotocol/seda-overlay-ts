import { SedaChain, initializeTelemetry, metricsHelpers, telemetryInitialized } from "@sedaprotocol/overlay-ts-common";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { MainTask } from "./tasks/main";

export interface RunOptions {
	skipIdentityInitialization?: boolean;
}

export async function runNode(appConfig: AppConfig, runOptions?: RunOptions) {
	// Initialize telemetry early
	initializeTelemetry();

	const sedaChain = await SedaChain.fromConfig(appConfig);

	if (sedaChain.isErr) {
		logger.error(`SedaChain creation error: ${sedaChain.error}`);

		// Record boot failure with enhanced telemetry
		if (telemetryInitialized) {
			metricsHelpers.recordCriticalError("node_boot", sedaChain.error as Error, {
				reason: "seda_chain_init_failure",
				boot_phase: "seda_chain_creation",
			});
		}

		process.exit(1);
	}

	const mainTask = new MainTask(appConfig, sedaChain.value);

	// Start the main task
	await mainTask.start();

	logger.info("✅ Node started successfully");
}
