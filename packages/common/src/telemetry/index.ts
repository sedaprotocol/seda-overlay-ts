import { metrics } from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

// Global state
let telemetryInitialized = false;
let metricsCollectionCleanup: (() => void) | null = null;
let tracerProvider: NodeTracerProvider;
let meterProvider: MeterProvider;

/**
 * Create metrics readers based on configuration
 */
function createMetricReaders(config: {
	metricsExporter: string;
	prometheusPort: number;
	prometheusHost: string;
	otlpEndpoint: string;
	metricsInterval: number;
}) {
	const readers = [];

	// Add OTLP exporter if requested
	if (config.metricsExporter === "otlp" || config.metricsExporter === "both") {
		const otlpMetricExporter = new OTLPMetricExporter({
			url: `${config.otlpEndpoint}/v1/metrics`,
		});

		readers.push(
			new PeriodicExportingMetricReader({
				exporter: otlpMetricExporter,
				exportIntervalMillis: config.metricsInterval,
			}),
		);
	}

	// Add Prometheus exporter if requested
	if (config.metricsExporter === "prometheus" || config.metricsExporter === "both") {
		const prometheusExporter = new PrometheusExporter({
			port: config.prometheusPort,
			host: config.prometheusHost,
			endpoint: "/metrics",
		});

		readers.push(prometheusExporter);
	}

	return readers;
}

/**
 * Initialize OpenTelemetry with both tracing and metrics
 */
export function initializeTelemetry(): boolean {
	if (telemetryInitialized) {
		console.log("📡 Telemetry already initialized");
		return true;
	}

	// Read configuration from environment variables at runtime
	const config = {
		otlpEndpoint: process.env.OTLP_ENDPOINT || "http://localhost:4318",
		serviceName: process.env.OTEL_SERVICE_NAME || "seda-overlay",
		serviceVersion: process.env.OTEL_SERVICE_VERSION || "1.0.0",
		metricsInterval: Number.parseInt(process.env.OTEL_METRICS_EXPORT_INTERVAL || "5000"),
		telemetryEnabled: process.env.OTEL_ENABLED !== "false",
		prometheusPort: Number.parseInt(process.env.OTEL_EXPORTER_PROMETHEUS_PORT || "9464"),
		prometheusHost: process.env.OTEL_EXPORTER_PROMETHEUS_HOST || "0.0.0.0",
		metricsExporter: process.env.OTEL_METRICS_EXPORTER || "otlp",
	};

	if (!config.telemetryEnabled) {
		console.log("📡 Telemetry disabled by configuration (OTEL_ENABLED=false)");
		return false;
	}

	try {
		// Create resource
		const resource = resourceFromAttributes({
			[ATTR_SERVICE_NAME]: config.serviceName,
			[ATTR_SERVICE_VERSION]: config.serviceVersion,
		});

		// Configure trace exporter
		const traceExporter = new OTLPTraceExporter({
			url: `${config.otlpEndpoint}/v1/traces`,
		});

		// Set up tracing
		tracerProvider = new NodeTracerProvider({
			resource,
			spanProcessors: [new SimpleSpanProcessor(traceExporter)],
		});

		// Create metric readers based on configuration
		const metricReaders = createMetricReaders(config);

		// Set up metrics with appropriate readers
		meterProvider = new MeterProvider({
			resource,
			readers: metricReaders,
		});

		// Register providers
		tracerProvider.register();
		metrics.setGlobalMeterProvider(meterProvider);

		// Start system metrics collection
		const { startSystemMetricsCollection } = require("./metrics");
		metricsCollectionCleanup = startSystemMetricsCollection();

		telemetryInitialized = true;

		console.log("📡 OpenTelemetry initialized successfully");
		console.log(`📊 Service: ${config.serviceName}@${config.serviceVersion}`);

		// Log export configuration
		if (config.metricsExporter === "prometheus" || config.metricsExporter === "both") {
			console.log(`📈 Prometheus metrics: http://${config.prometheusHost}:${config.prometheusPort}/metrics`);
		}
		if (config.metricsExporter === "otlp" || config.metricsExporter === "both") {
			console.log(`📡 OTLP endpoint: ${config.otlpEndpoint}`);
		}

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
