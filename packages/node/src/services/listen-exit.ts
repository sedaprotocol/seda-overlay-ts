import { getRuntime } from "@sedaprotocol/overlay-ts-common";
import { logger } from "@sedaprotocol/overlay-ts-logger";

export function listenForExit(onExitSignal: () => Promise<void>) {
	const signals = ["SIGHUP", "SIGINT", "SIGQUIT", "SIGTRAP", "SIGABRT", "SIGBUS", "SIGUSR1", "SIGUSR2", "SIGTERM"];

	if (getRuntime() !== "deno") {
		signals.push("SIGILL");
		signals.push("SIGFPE");
		signals.push("SIGSEGV");
	}

	for (const signal of signals) {
		process.on(signal, async () => {
			logger.info(`Received exit signal ${signal}, exiting gracefully..`);
			await onExitSignal();
			process.exit(0);
		});
	}
}
