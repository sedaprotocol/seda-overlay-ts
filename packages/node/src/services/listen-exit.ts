import { logger } from "@sedaprotocol/overlay-ts-logger";

export function listenForExit(onExitSignal: () => Promise<void>) {
	const signals = [
		"SIGHUP",
		"SIGINT",
		"SIGQUIT",
		"SIGILL",
		"SIGTRAP",
		"SIGABRT",
		"SIGBUS",
		"SIGFPE",
		"SIGUSR1",
		"SIGSEGV",
		"SIGUSR2",
		"SIGTERM",
	];

	for (const signal of signals) {
		process.on(signal, async () => {
			logger.info(`Received exit signal ${signal}, exiting gracefully..`);
			await onExitSignal();
			process.exit(0);
		});
	}
}
