import { metrics } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

// Configuration from environment variables
const OTLP_ENDPOINT = process.env.OTLP_ENDPOINT || "http://localhost:4318";
const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || "seda-overlay";
const SERVICE_VERSION = process.env.OTEL_SERVICE_VERSION || "1.0.0";
const METRICS_EXPORT_INTERVAL = Number.parseInt(process.env.OTEL_METRICS_EXPORT_INTERVAL || "5000");
const TELEMETRY_ENABLED = process.env.OTEL_ENABLED !== "false"; // Default to enabled

// Global state
let telemetryInitialized = false;
let metricsCollectionCleanup: (() => void) | null = null;

// Create resource
const resource = resourceFromAttributes({
	[ATTR_SERVICE_NAME]: SERVICE_NAME,
	[ATTR_SERVICE_VERSION]: SERVICE_VERSION,
});

// Configure trace exporter
const traceExporter = new OTLPTraceExporter({
	url: `${OTLP_ENDPOINT}/v1/traces`,
});

// Configure metrics exporter
const metricExporter = new OTLPMetricExporter({
	url: `${OTLP_ENDPOINT}/v1/metrics`,
});

// Set up tracing
const tracerProvider = new NodeTracerProvider({
	resource,
	spanProcessors: [new SimpleSpanProcessor(traceExporter)],
});

// Set up metrics
const meterProvider = new MeterProvider({
	resource,
	readers: [
		new PeriodicExportingMetricReader({
			exporter: metricExporter,
			exportIntervalMillis: METRICS_EXPORT_INTERVAL,
		}),
	],
});

/**
 * Initialize OpenTelemetry with both tracing and metrics
 */
export function initializeTelemetry(): boolean {
	if (telemetryInitialized) {
		console.log("📡 Telemetry already initialized");
		return true;
	}

	if (!TELEMETRY_ENABLED) {
		console.log("📡 Telemetry disabled by configuration (OTEL_ENABLED=false)");
		return false;
	}

	try {
		// Register providers
		tracerProvider.register();
		metrics.setGlobalMeterProvider(meterProvider);

		// Start system metrics collection
		const { startSystemMetricsCollection } = require("./metrics");
		metricsCollectionCleanup = startSystemMetricsCollection();

		telemetryInitialized = true;
		
		console.log("📡 OpenTelemetry initialized successfully");
		console.log(`📊 Service: ${SERVICE_NAME}@${SERVICE_VERSION}`);
		console.log(`📈 Endpoint: ${OTLP_ENDPOINT}`);

		// Set up graceful shutdown
		setupGracefulShutdown();

		return true;
		
	} catch (error) {
		console.error("❌ Failed to initialize telemetry:", error);
		return false;
	}
}

/**
 * Setup graceful shutdown handlers
 */
function setupGracefulShutdown(): void {
	const shutdown = async () => {
		if (!telemetryInitialized) {
			return;
		}

		console.log("📡 Shutting down telemetry...");

		if (metricsCollectionCleanup) {
			metricsCollectionCleanup();
			metricsCollectionCleanup = null;
		}

		try {
			await tracerProvider.forceFlush();
			await meterProvider.forceFlush();
			await tracerProvider.shutdown();
			await meterProvider.shutdown();
			telemetryInitialized = false;
			console.log("📡 Telemetry shutdown complete");
		} catch (error) {
			console.error("❌ Error during telemetry shutdown:", error);
		}
	};

	// Handle various shutdown signals
	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
}

/**
 * Gracefully shutdown telemetry
 */
export async function shutdownTelemetry() {
	if (!telemetryInitialized) {
		return;
	}

	console.log("📡 Manual shutdown requested...");

	if (metricsCollectionCleanup) {
		metricsCollectionCleanup();
		metricsCollectionCleanup = null;
	}

	try {
		await tracerProvider.forceFlush();
		await meterProvider.forceFlush();
		await tracerProvider.shutdown();
		await meterProvider.shutdown();
		telemetryInitialized = false;
		console.log("📡 Manual shutdown complete");
	} catch (error) {
		console.error("❌ Error during manual shutdown:", error);
	}
}

export { telemetryInitialized };
