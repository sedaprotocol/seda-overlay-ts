/**
 * OpenTelemetry Decorators
 */

import { trace, SpanStatusCode, SpanKind } from '@opentelemetry/api';
import { customMetrics, metricsHelpers } from './metrics.js';

const tracer = trace.getTracer('seda-overlay-decorators', '1.0.0');

/**
 * Decorator options for tracing
 */
export interface TracedOptions {
  /** Custom operation name (defaults to className.methodName) */
  operationName?: string;
  /** Span kind (defaults to INTERNAL) */
  spanKind?: SpanKind;
  /** Whether to record errors as exceptions */
  recordExceptions?: boolean;
  /** Custom attributes to add to the span */
  attributes?: Record<string, string>;
}

/**
 * Method decorator that automatically traces method execution
 * 
 * @example
 * ```typescript
 * class MyService {
 *   @Traced()
 *   async processData(data: any) {
 *     // Method will be automatically traced
 *     return this.doWork(data);
 *   }
 * 
 *   @Traced({ operationName: 'custom_operation' })
 *   customMethod() {
 *     // Custom operation name in traces
 *   }
 * }
 * ```
 */
export function Traced(options: TracedOptions = {}) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const className = target.constructor.name;
    const operationName = options.operationName || `${className}.${propertyKey}`;

    descriptor.value = async function (...args: any[]) {
      const startTime = Date.now();
      
      return tracer.startActiveSpan(operationName, {
        kind: options.spanKind || SpanKind.INTERNAL,
        attributes: {
          'code.function': propertyKey,
          'code.namespace': className,
          ...options.attributes,
        },
      }, async (span) => {
        try {
          // Execute original method
          const result = await originalMethod.apply(this, args);
          
          // Record success
          span.setStatus({ code: SpanStatusCode.OK });
          metricsHelpers.recordDuration(operationName, Date.now() - startTime, true, {
            class: className,
            method: propertyKey,
          });

          return result;
        } catch (error) {
          // Record error
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : 'Unknown error',
          });

          if (options.recordExceptions !== false && error instanceof Error) {
            span.recordException(error);
          }

          // Record duration for failed operations
          metricsHelpers.recordDuration(operationName, Date.now() - startTime, false, {
            class: className,
            method: propertyKey,
            error_type: error instanceof Error ? error.constructor.name : 'Unknown',
          });

          // Record error metric
          customMetrics.errorTotal.add(1, {
            operation: operationName,
            error_type: error instanceof Error ? error.constructor.name : 'Unknown',
            severity: 'high', // Default severity for decorated methods
          });

          throw error;
        } finally {
          span.end();
        }
      });
    };

    return descriptor;
  };
}

/**
 * Method decorator specifically for monitoring critical operations
 * Automatically increments specific error metrics based on operation type
 */
export function MonitorCritical(metricName: keyof typeof customMetrics) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const className = target.constructor.name;

    descriptor.value = async function (...args: any[]) {
      try {
        return await originalMethod.apply(this, args);
      } catch (error) {
        // Increment the specific critical metric
        const metric = customMetrics[metricName];
        if (metric && 'add' in metric) {
          (metric as any).add(1, {
            class: className,
            method: propertyKey,
            error_type: error instanceof Error ? error.constructor.name : 'Unknown',
          });
        }

        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * Method decorator for monitoring RPC operations
 * Includes special handling for consecutive failure detection
 */
export function MonitorRPC(endpoint?: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const className = target.constructor.name;
    const rpcEndpoint = endpoint || `${className}.${propertyKey}`;

    descriptor.value = async function (...args: any[]) {
      const startTime = Date.now();

      try {
        const result = await originalMethod.apply(this, args);
        
        // Record successful RPC
        customMetrics.rpcRequestsTotal.add(1, {
          endpoint: rpcEndpoint,
          status: 'success',
          method: propertyKey,
        });

        customMetrics.rpcRequestDuration.record(Date.now() - startTime, {
          endpoint: rpcEndpoint,
          status: 'success',
        });

        return result;
      } catch (error) {
        // Record RPC error
        metricsHelpers.incrementRpcError(rpcEndpoint, error instanceof Error ? error : new Error('Unknown RPC error'));

        customMetrics.rpcRequestsTotal.add(1, {
          endpoint: rpcEndpoint,
          status: 'error',
          method: propertyKey,
          error_type: error instanceof Error ? error.constructor.name : 'Unknown',
        });

        customMetrics.rpcRequestDuration.record(Date.now() - startTime, {
          endpoint: rpcEndpoint,
          status: 'error',
        });

        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * Class decorator to automatically trace all public methods
 * Useful for comprehensive observability across a service
 */
export function TraceClass(options: Omit<TracedOptions, 'operationName'> = {}) {
  return function <T extends { new (...args: any[]): {} }>(constructor: T) {
    const prototype = constructor.prototype;
    const methodNames = Object.getOwnPropertyNames(prototype)
      .filter(name => {
        return name !== 'constructor' && 
               typeof prototype[name] === 'function' &&
               !name.startsWith('_'); // Skip private methods by convention
      });

    methodNames.forEach(methodName => {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, methodName);
      if (descriptor && descriptor.value) {
        const tracedDescriptor = Traced({
          ...options,
          operationName: `${constructor.name}.${methodName}`,
        })(prototype, methodName, descriptor);
        
        Object.defineProperty(prototype, methodName, tracedDescriptor);
      }
    });

    return constructor;
  };
} 