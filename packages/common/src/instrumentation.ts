import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
// import { ConsoleMetricExporter, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-node";
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";

const sdk = new NodeSDK({
	traceExporter: new ConsoleSpanExporter(),
	// metricReader: new PeriodicExportingMetricReader({
	// 	exporter: new ConsoleMetricExporter(),
	// }),
	metricReader: new PrometheusExporter({
		port: 9100,
		prefix: "seda_overlay_",
	}),
	instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();
