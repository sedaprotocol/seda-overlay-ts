/**
 * OpenTelemetry Providers Setup
 * Comprehensive setup for tracing and metrics providers
 */

import { trace, metrics } from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { NodeTracerProvider, BatchSpanProcessor, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { MeterProvider, PeriodicExportingMetricReader, ConsoleMetricExporter } from '@opentelemetry/sdk-metrics';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';

import type { TelemetryConfig } from './config.js';

/**
 * Global provider instances
 */
let tracerProvider: NodeTracerProvider | null = null;
let meterProvider: MeterProvider | null = null;

/**
 * Initialize OpenTelemetry providers
 */
export function initializeProviders(config: TelemetryConfig): void {
  if (!config.enabled) {
    console.log('[Telemetry] Disabled by configuration');
    return;
  }

  console.log('[Telemetry] Initializing OpenTelemetry providers...');

  // Create shared resource
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: config.serviceName,
    [ATTR_SERVICE_VERSION]: config.serviceVersion,
    ...config.globalAttributes,
  });

  // Initialize tracing provider
  tracerProvider = createTracerProvider(resource, config);
  
  // Initialize metrics provider  
  meterProvider = createMeterProvider(resource, config);

  // Register global providers
  trace.setGlobalTracerProvider(tracerProvider);
  metrics.setGlobalMeterProvider(meterProvider);

  console.log(`[Telemetry] Initialized for service: ${config.serviceName} v${config.serviceVersion}`);
}

/**
 * Create and configure tracer provider
 */
function createTracerProvider(resource: any, config: TelemetryConfig): NodeTracerProvider {
  const spanProcessors = [];

  // Add exporters
  if (config.otlpEndpoint) {
    const otlpExporter = new OTLPTraceExporter({
      url: config.otlpEndpoint,
    });
    
    // Use BatchSpanProcessor for production performance
    spanProcessors.push(new BatchSpanProcessor(otlpExporter, {
      maxQueueSize: 1000,
      scheduledDelayMillis: 5000,
      exportTimeoutMillis: 10000,
      maxExportBatchSize: 512,
    }));
  }

  // Add console exporter for development
  if (config.logToConsole) {
    const { ConsoleSpanExporter } = require('@opentelemetry/sdk-trace-base');
    spanProcessors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
  }

  const provider = new NodeTracerProvider({
    resource,
    spanProcessors,
    // Use probability-based sampling
    sampler: {
      shouldSample: () => ({
        decision: Math.random() < config.sampleRate ? 1 : 0, // SamplingDecision.RECORD_AND_SAMPLE : SamplingDecision.NOT_RECORD
      }),
    } as any, // Simple sampling implementation
  });

  return provider;
}

/**
 * Create and configure meter provider
 */
function createMeterProvider(resource: any, config: TelemetryConfig): MeterProvider {
  const readers = [];

  // Add OTLP metrics exporter
  if (config.otlpEndpoint) {
    const otlpMetricExporter = new OTLPMetricExporter({
      url: config.otlpEndpoint.replace('/traces', '/metrics'), // Adjust URL for metrics
    });

    readers.push(new PeriodicExportingMetricReader({
      exporter: otlpMetricExporter,
      exportIntervalMillis: 10000, // Export every 10 seconds
      exportTimeoutMillis: 5000,
    }));
  }

  // Add console exporter for development
  if (config.logToConsole) {
    readers.push(new PeriodicExportingMetricReader({
      exporter: new ConsoleMetricExporter(),
      exportIntervalMillis: 15000, // Less frequent console exports
    }));
  }

  return new MeterProvider({
    resource,
    readers,
  });
}

/**
 * Gracefully shutdown providers
 */
export async function shutdownProviders(): Promise<void> {
  console.log('[Telemetry] Shutting down providers...');

  const promises = [];

  if (tracerProvider) {
    promises.push(tracerProvider.shutdown());
  }

  if (meterProvider) {
    promises.push(meterProvider.shutdown());
  }

  await Promise.all(promises);
  console.log('[Telemetry] Providers shut down successfully');
}

/**
 * Force flush all providers (useful for serverless environments)
 */
export async function flushProviders(): Promise<void> {
  const promises = [];

  if (tracerProvider) {
    promises.push(tracerProvider.forceFlush());
  }

  if (meterProvider) {
    promises.push(meterProvider.forceFlush());
  }

  await Promise.all(promises);
}

/**
 * Get initialized providers (for testing/debugging)
 */
export function getProviders() {
  return {
    tracerProvider,
    meterProvider,
  };
} 