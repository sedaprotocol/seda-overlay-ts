import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

const exporter = new OTLPTraceExporter({
    url: process.env.OTLP_ENDPOINT,
});

const provider = new NodeTracerProvider({
	resource: resourceFromAttributes({
		[ATTR_SERVICE_NAME]: "seda-overlay",
	}),
	spanProcessors: [new SimpleSpanProcessor(exporter)],
});

provider.register();