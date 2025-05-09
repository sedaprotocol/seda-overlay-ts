import { isBrowser } from "@sedaprotocol/overlay-ts-common";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { Maybe } from "true-myth";
import { logs } from "@opentelemetry/api-logs";
import { type Logger as WinstonLogger, format, transports } from "winston";
import { LoggerProvider, SimpleLogRecordProcessor, ConsoleLogRecordExporter } from "@opentelemetry/sdk-logs";
import { OpenTelemetryTransportV3 } from "@opentelemetry/winston-transport";
import "winston-daily-rotate-file";

const logFormat = (withColors: boolean) =>
	format.printf((info) => {
		// @ts-ignore
		const id = Maybe.of(info.metadata?.id).mapOr("", (t) => {
			return withColors ? `[${cyan(t)}] ` : `[${t}] `;
		});
		const logMsg = `${info.timestamp} ${info.level}: ${id}`;

		// @ts-ignore
		return Maybe.of(info.metadata?.error).mapOr(
			`${logMsg}${info.message}`,
			(err) => `${logMsg} ${info.message} ${err}`,
		);
	});

type ExtraInfo = {
	id?: string;
	error?: Error | string;
};

function cyan(val: string) {
	return `\x1b[36m${val}\x1b[0m`;
}

const consoleTransport = new transports.Console({
	format: format.combine(format.colorize(), logFormat(true)),
});

export class Logger {
	winston: Maybe<WinstonLogger> = Maybe.nothing();

	async init(appConfig: AppConfig) {
		const loggerProvider = new LoggerProvider();

		loggerProvider.addLogRecordProcessor(new SimpleLogRecordProcessor(new ConsoleLogRecordExporter()));
		logs.setGlobalLoggerProvider(loggerProvider);

		if (!isBrowser()) {
			const { createLogger, format } = await import("winston");

			const myTransports = [];
			myTransports.push(consoleTransport);
			myTransports.push(new OpenTelemetryTransportV3())

			if (appConfig.node.logRotationEnabled) {
				const rotateFileTransport = new transports.DailyRotateFile({
					level: appConfig.node.logRotationLevel,
					dirname: appConfig.logsDir,
					filename: "seda-overlay-%DATE%.log",
					datePattern: "YYYY-MM-DD",
					zippedArchive: true,
					maxFiles: appConfig.node.logRotationMaxFiles,
					maxSize: appConfig.node.logRotationMaxSize,
					format: logFormat(false),
				});
				myTransports.push(rotateFileTransport);
			}

			this.winston = Maybe.just(
				createLogger({
					level: "debug",
					transports: myTransports,
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
