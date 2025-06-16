// import * as opentelemetry from '@opentelemetry/api';
// import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
// import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
// import { BasicTracerProvider, ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
// import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
// import { CompositePropagator, W3CTraceContextPropagator, W3CBaggagePropagator } from '@opentelemetry/core';

// const exporter = new JaegerExporter({
// 	serviceName: "seda-overlay",
// 	endpoint: "http://localhost:14268/api/traces",
// });

// const tracerProvider = new TracerProvider({
// 	resource: new Resource({
// 		[SemanticResourceAttributes.SERVICE_NAME]: "seda-overlay",
// 	});

// TODO: Set URL
const exporter = new OTLPTraceExporter();

const provider = new NodeTracerProvider({
	resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: "seda-overlay",
    }),
    spanProcessors: [new SimpleSpanProcessor(exporter)],
});

provider.register();

// const span = tracer.startSpan("test");

// span.setAttribute("world", "hello");

// span.addEvent("test", {
//     world: "hello",
// });

// span.end();

// span.end();