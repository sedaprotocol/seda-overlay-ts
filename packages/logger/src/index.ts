import { isBrowser } from "@sedaprotocol/overlay-ts-common";
import { Maybe } from "true-myth";
import { type Logger as WinstonLogger, format, type transport, transports } from "winston";

const logFormat = format.printf((info) => {
	// @ts-ignore
	const id = Maybe.of(info.metadata?.id).mapOr("", (t) => {
		return `[${cyan(t)}] `;
	});
	const logMsg = `${info.timestamp} ${info.level}: ${id}`;

	// @ts-ignore
	return Maybe.of(info.metadata?.error).mapOr(`${logMsg}${info.message}`, (err) => `${logMsg} ${info.message} ${err}`);
});

type ExtraInfo = {
	id?: string;
	error?: Error | string;
};

function cyan(val: string) {
	return `\x1b[36m${val}\x1b[0m`;
}

const destinations: transport[] = [
	new transports.Console({
		format: format.combine(format.colorize(), logFormat),
	}),
];

export class Logger {
	winston: Maybe<WinstonLogger> = Maybe.nothing();

	async init() {
		if (!isBrowser()) {
			const { createLogger, format } = await import("winston");

			this.winston = Maybe.just(
				createLogger({
					level: "debug",
					transports: destinations,
					format: format.combine(
						format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
						format.metadata({
							fillExcept: ["message", "level", "timestamp", "label"],
						}),
						format.errors({ stack: true }),
					),
				}),
			);
		}
	}

	trace(message: string, extra?: ExtraInfo): void {
		if (this.winston.isJust) {
			this.winston.value.debug(`${message}: ${new Error().stack}`, extra);
		} else {
			console.trace(message);
		}
	}

	info(message: string, extra?: ExtraInfo): void {
		if (this.winston.isJust) {
			this.winston.value.info(message, extra);
		} else {
			console.info(message);
		}
	}

	debug(message: string, extra?: ExtraInfo) {
		if (this.winston.isJust) {
			this.winston.value.debug(message, extra);
		} else {
			console.debug(message);
		}
	}

	warn(message: string, extra?: ExtraInfo) {
		if (this.winston.isJust) {
			this.winston.value.warn(message, extra);
		} else {
			console.warn(message);
		}
	}

	error(message: string, extra?: ExtraInfo) {
		if (this.winston.isJust) {
			this.winston.value.error(message, extra);
		} else {
			console.error(message);
		}
	}
}

export const logger = new Logger();
await logger.init();
