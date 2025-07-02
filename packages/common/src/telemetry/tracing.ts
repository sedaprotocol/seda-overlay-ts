/**
 * OpenTelemetry Tracing Utilities
 * Manual tracing utilities for when decorators aren't suitable
 */

import { trace, SpanStatusCode, SpanKind, type Span } from '@opentelemetry/api';
import { customMetrics, metricsHelpers } from './metrics.js';

const tracer = trace.getTracer('seda-overlay-tracing', '1.0.0');

/**
 * Options for manual tracing
 */
export interface TracingOptions {
  /** Span kind */
  spanKind?: SpanKind;
  /** Custom attributes */
  attributes?: Record<string, string>;
  /** Whether to record exceptions */
  recordExceptions?: boolean;
}

/**
 * Utility class for manual tracing operations
 */
export class TracingUtils {
  /**
   * Trace an async operation manually
   * 
   * @example
   * ```typescript
   * const result = await TracingUtils.traceOperation('data_processing', async () => {
   *   return await processData();
   * });
   * ```
   */
  static async traceOperation<T>(
    operationName: string,
    operation: () => Promise<T>,
    options: TracingOptions = {}
  ): Promise<T> {
    const startTime = Date.now();
    
    return tracer.startActiveSpan(operationName, {
      kind: options.spanKind || SpanKind.INTERNAL,
      attributes: options.attributes,
    }, async (span) => {
      try {
        const result = await operation();
        
        span.setStatus({ code: SpanStatusCode.OK });
        metricsHelpers.recordDuration(operationName, Date.now() - startTime, true);
        
        return result;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'Unknown error',
        });

        if (options.recordExceptions !== false && error instanceof Error) {
          span.recordException(error);
        }

        metricsHelpers.recordDuration(operationName, Date.now() - startTime, false, {
          error_type: error instanceof Error ? error.constructor.name : 'Unknown',
        });

        customMetrics.errorTotal.add(1, {
          operation: operationName,
          error_type: error instanceof Error ? error.constructor.name : 'Unknown',
          severity: 'medium',
        });

        throw error;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Trace a synchronous operation
   */
  static traceSync<T>(
    operationName: string,
    operation: () => T,
    options: TracingOptions = {}
  ): T {
    const startTime = Date.now();
    
    return tracer.startActiveSpan(operationName, {
      kind: options.spanKind || SpanKind.INTERNAL,
      attributes: options.attributes,
    }, (span) => {
      try {
        const result = operation();
        
        span.setStatus({ code: SpanStatusCode.OK });
        metricsHelpers.recordDuration(operationName, Date.now() - startTime, true);
        
        return result;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'Unknown error',
        });

        if (options.recordExceptions !== false && error instanceof Error) {
          span.recordException(error);
        }

        metricsHelpers.recordDuration(operationName, Date.now() - startTime, false, {
          error_type: error instanceof Error ? error.constructor.name : 'Unknown',
        });

        throw error;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Create a child span of the current active span
   */
  static createChildSpan(name: string, options: TracingOptions = {}): Span {
    return tracer.startSpan(name, {
      kind: options.spanKind || SpanKind.INTERNAL,
      attributes: options.attributes,
    });
  }

  /**
   * Get the current active span
   */
  static getCurrentSpan(): Span | undefined {
    return trace.getActiveSpan();
  }

  /**
   * Add attributes to the current active span
   */
  static addAttributesToCurrentSpan(attributes: Record<string, string>): void {
    const span = trace.getActiveSpan();
    if (span) {
      span.setAttributes(attributes);
    }
  }

  /**
   * Record an exception in the current active span
   */
  static recordException(error: Error): void {
    const span = trace.getActiveSpan();
    if (span) {
      span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      });
    }
  }

  /**
   * Create a span for RPC operations with consistent naming
   */
  static async traceRPCOperation<T>(
    endpoint: string,
    method: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const operationName = `rpc.${endpoint}.${method}`;
    const startTime = Date.now();

    return tracer.startActiveSpan(operationName, {
      kind: SpanKind.CLIENT,
      attributes: {
        'rpc.endpoint': endpoint,
        'rpc.method': method,
        'component': 'rpc_client',
      },
    }, async (span) => {
      try {
        const result = await operation();
        
        span.setStatus({ code: SpanStatusCode.OK });
        
        // Record successful RPC metrics
        customMetrics.rpcRequestsTotal.add(1, {
          endpoint,
          method,
          status: 'success',
        });
        
        customMetrics.rpcRequestDuration.record(Date.now() - startTime, {
          endpoint,
          method,
          status: 'success',
        });
        
        return result;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'RPC error',
        });

        span.recordException(error instanceof Error ? error : new Error('Unknown RPC error'));

        // Record RPC error metrics
        metricsHelpers.incrementRpcError(endpoint, error instanceof Error ? error : new Error('Unknown RPC error'));
        
        customMetrics.rpcRequestsTotal.add(1, {
          endpoint,
          method,
          status: 'error',
          error_type: error instanceof Error ? error.constructor.name : 'Unknown',
        });
        
        customMetrics.rpcRequestDuration.record(Date.now() - startTime, {
          endpoint,
          method,
          status: 'error',
        });

        throw error;
      } finally {
        span.end();
      }
    });
  }
}

/**
 * SEDA-specific tracing helpers
 */
export class SedaTracing {
  /**
   * Trace data request processing
   */
  static async traceDataRequest<T>(
    dataRequestId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    return TracingUtils.traceOperation(`seda.data_request.${dataRequestId}`, operation, {
      spanKind: SpanKind.INTERNAL,
      attributes: {
        'seda.data_request.id': dataRequestId,
        'seda.operation': 'data_request_processing',
      },
    });
  }

  /**
   * Trace staking operations
   */
  static async traceStakingOperation<T>(
    operation: string,
    stakerId: string,
    callback: () => Promise<T>
  ): Promise<T> {
    return TracingUtils.traceOperation(`seda.staking.${operation}`, callback, {
      spanKind: SpanKind.INTERNAL,
      attributes: {
        'seda.staker.id': stakerId,
        'seda.operation': operation,
      },
    });
  }

  /**
   * Trace consensus operations
   */
  static async traceConsensusOperation<T>(
    operation: string,
    round: number,
    callback: () => Promise<T>
  ): Promise<T> {
    return TracingUtils.traceOperation(`seda.consensus.${operation}`, callback, {
      spanKind: SpanKind.INTERNAL,
      attributes: {
        'seda.consensus.round': round.toString(),
        'seda.operation': operation,
      },
    });
  }
}

/**
 * Export convenience functions
 */
export const { traceOperation, traceSync, traceRPCOperation } = TracingUtils; 