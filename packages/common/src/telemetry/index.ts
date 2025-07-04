/**
 * SEDA Overlay Telemetry Infrastructure
 * Comprehensive OpenTelemetry setup for enterprise observability
 */

import { loadTelemetryConfig } from './config.js';
import { initializeProviders, shutdownProviders, flushProviders } from './providers.js';
import { customMetrics, metricsHelpers } from './metrics.js';
import { TracingUtils, SedaTracing, traceOperation, traceSync, traceRPCOperation } from './tracing.js';
import { Traced, MonitorCritical, MonitorRPC, TraceClass } from './decorators.js';

/**
 * Global telemetry state
 */
let isInitialized = false;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Initialize the complete telemetry infrastructure
 * Call this once at application startup
 */
export function initializeTelemetry(): void {
	if (isInitialized) {
		console.log('[Telemetry] Already initialized, skipping...');
		return;
	}

	try {
		const config = loadTelemetryConfig();
		
		if (!config.enabled) {
			console.log('[Telemetry] Disabled by configuration');
			return;
		}

		// Initialize OpenTelemetry providers
		initializeProviders(config);
		
				// Set up graceful shutdown
		setupGracefulShutdown();

		// Start heartbeat for telemetry testing
		startHeartbeat();

		isInitialized = true;
		console.log('[Telemetry] 🚀 SEDA Overlay telemetry initialized successfully!');
		
		// Log configuration for debugging
		if (config.logToConsole) {
			console.log('[Telemetry] Configuration:', {
				serviceName: config.serviceName,
				serviceVersion: config.serviceVersion,
				environment: config.environment,
				sampleRate: config.sampleRate,
				otlpEndpoint: config.otlpEndpoint ? '[CONFIGURED]' : '[NOT SET]',
			});
		}
	} catch (error) {
		console.error('[Telemetry] Failed to initialize:', error);
		// Don't throw - telemetry failures shouldn't break the application
	}
}

/**
 * Setup graceful shutdown handlers
 */
function setupGracefulShutdown(): void {
	const shutdown = async () => {
		console.log('[Telemetry] Shutting down...');
		try {
			await flushProviders();
			await shutdownProviders();
			console.log('[Telemetry] Shutdown complete');
		} catch (error) {
			console.error('[Telemetry] Error during shutdown:', error);
		}
	};

	// Graceful shutdown on various signals
	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);
	process.on('beforeExit', shutdown);
}

/**
 * Manual flush for serverless environments
 */
export async function flushTelemetry(): Promise<void> {
	if (!isInitialized) {
		return;
	}
	
	try {
		await flushProviders();
	} catch (error) {
		console.error('[Telemetry] Error flushing telemetry:', error);
	}
}

/**
 * Start heartbeat metric for telemetry testing
 * Increments every 5 seconds so you can verify metrics are being exported
 */
function startHeartbeat(): void {
	if (heartbeatInterval) {
		clearInterval(heartbeatInterval);
	}

	let heartbeatCount = 0;
	
	heartbeatInterval = setInterval(() => {
		heartbeatCount++;
		console.log(`[Telemetry] 💗 Heartbeat #${heartbeatCount} - sending test metric`);
		
		// Use the enhanced helper for logging
		metricsHelpers.incrementCounter(
			customMetrics.heartbeat, 
			'overlay_heartbeat_total', 
			1, 
			{ 
				heartbeat_id: heartbeatCount.toString(),
				service_name: 'seda-overlay',
				timestamp: new Date().toISOString()
			}
		);
	}, 5000); // Every 5 seconds

	console.log('[Telemetry] ⏰ Heartbeat started - will emit test metric every 5 seconds');
}

/**
 * Stop heartbeat (for cleanup)
 */
function stopHeartbeat(): void {
	if (heartbeatInterval) {
		clearInterval(heartbeatInterval);
		heartbeatInterval = null;
		console.log('[Telemetry] ⏰ Heartbeat stopped');
	}
}

// =================================================================
// EXPORTS - Clean API for the rest of the application
// =================================================================

// Configuration
export { loadTelemetryConfig } from './config.js';
export type { TelemetryConfig } from './config.js';

// Custom metrics - Ready to use!
export { customMetrics, metricsHelpers };

// Decorators - For easy method instrumentation
export { Traced, MonitorCritical, MonitorRPC, TraceClass };

// Manual tracing utilities
export { TracingUtils, SedaTracing, traceOperation, traceSync, traceRPCOperation };
export type { TracingOptions } from './tracing.js';

// Decorator options
export type { TracedOptions } from './decorators.js';

/**
 * Convenience re-exports from OpenTelemetry API
 */
export { trace, metrics, SpanKind, SpanStatusCode } from '@opentelemetry/api';

/**
 * Get telemetry status
 */
export function getTelemetryStatus() {
	return {
		initialized: isInitialized,
		config: isInitialized ? loadTelemetryConfig() : null,
	};
}

// Auto-initialize if this module is imported and telemetry is enabled
// This ensures telemetry works even if initializeTelemetry() isn't called explicitly
if (process.env.OTEL_ENABLED === 'true' || process.env.NODE_ENV === 'production') {
	initializeTelemetry();
}
