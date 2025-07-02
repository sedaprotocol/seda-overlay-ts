/**
 * OpenTelemetry Configuration
 * Centralized configuration for all telemetry concerns
 */

export interface TelemetryConfig {
  enabled: boolean;
  serviceName: string;
  /** Service version */
  serviceVersion: string;
  /** Environment (devnet, testnet, mainnet) */
  environment: string;
  /** OTLP endpoint for traces */
  otlpEndpoint?: string;
  /** Sample rate for traces (0.0 to 1.0) */
  sampleRate: number;
  /** Whether to log telemetry to console ( only use for development; produces a ton of logs) */
  logToConsole: boolean;
  /** Custom attributes to add to all telemetry */
  globalAttributes?: Record<string, string>;
}

/**
 * Load telemetry configuration from environment variables
 */
export function loadTelemetryConfig(): TelemetryConfig {
  return {
    enabled: process.env.OTEL_ENABLED === 'true' || process.env.NODE_ENV === 'production',
    serviceName: process.env.OTEL_SERVICE_NAME || 'seda-overlay', // TODO: check if I can inherit POD name
    serviceVersion: process.env.OTEL_SERVICE_VERSION || '1.0.0-rc.22',
    environment: process.env.NODE_ENV || 'testnet',
    otlpEndpoint: process.env.OTLP_ENDPOINT,
    sampleRate: parseFloat(process.env.OTEL_SAMPLE_RATE || '1.0'),
    logToConsole: process.env.NODE_ENV === 'devnet' || process.env.OTEL_LOG_CONSOLE === 'true',
    globalAttributes: {
      'service.environment': process.env.NODE_ENV || 'testnet',
      'service.instance.id': process.env.HOSTNAME || 'unknown',
    },
  };
} 