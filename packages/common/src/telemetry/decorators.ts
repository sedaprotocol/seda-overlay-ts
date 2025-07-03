import { trace, type Span, SpanStatusCode, SpanKind } from "@opentelemetry/api";

const tracer = trace.getTracer("seda-overlay-decorators", "1.0.0");

export interface TracedOptions {
	spanName?: string;
	spanKind?: SpanKind;
	attributes?: Record<string, string | number | boolean>;
}

export function Traced(options: TracedOptions = {}) {
	return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
		if (!descriptor.value) {
			throw new Error("@Traced can only be applied to methods");
		}

		const originalMethod = descriptor.value;
		const spanName = options.spanName || `${target.constructor.name}.${propertyKey}`;

		descriptor.value = function (...args: any[]) {
			return tracer.startActiveSpan(spanName, (span: Span) => {
				try {
					span.setAttributes({
						"method.name": propertyKey,
						"class.name": target.constructor.name,
						...options.attributes,
					});

					const result = originalMethod.apply(this, args);

					if (result && typeof result.then === "function") {
						return result
							.then((asyncResult: any) => {
								span.setStatus({ code: SpanStatusCode.OK });
								return asyncResult;
							})
							.catch((error: Error) => {
								span.recordException(error);
								span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
								throw error;
							})
							.finally(() => span.end());
					} else {
						span.setStatus({ code: SpanStatusCode.OK });
						span.end();
						return result;
					}
				} catch (error: any) {
					span.recordException(error);
					span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
					span.end();
					throw error;
				}
			});
		};

		return descriptor;
	};
}

export function MonitorCritical(options: TracedOptions = {}) {
	return Traced({
		...options,
		spanName: options.spanName || `critical.operation`,
		attributes: { operation_type: "critical", ...options.attributes },
	});
}

export function MonitorRPC(options: TracedOptions & { endpoint?: string } = {}) {
	const rpcAttributes: Record<string, string | number | boolean> = {
		...options.attributes,
	};
	
	if (options.endpoint) {
		rpcAttributes.rpc_endpoint = options.endpoint;
	}

	return Traced({
		...options,
		spanName: options.spanName || `rpc.${options.endpoint || "call"}`,
		spanKind: SpanKind.CLIENT,
		attributes: rpcAttributes,
	});
}

export function TraceClass(options: { prefix?: string } = {}) {
	return function (constructor: any) {
		const methodNames = Object.getOwnPropertyNames(constructor.prototype);
		
		for (const methodName of methodNames) {
			if (methodName === "constructor") continue;
			
			const descriptor = Object.getOwnPropertyDescriptor(constructor.prototype, methodName);
			if (descriptor && typeof descriptor.value === "function") {
				const spanName = options.prefix ? `${options.prefix}.${methodName}` : `${constructor.name}.${methodName}`;
				Traced({ spanName })(constructor.prototype, methodName, descriptor);
				Object.defineProperty(constructor.prototype, methodName, descriptor);
			}
		}
		
		return constructor;
	};
}

export async function withSpan<T>(
	name: string,
	fn: (span: Span) => Promise<T> | T
): Promise<T> {
	return tracer.startActiveSpan(name, async (span: Span) => {
		try {
			const result = await fn(span);
			span.setStatus({ code: SpanStatusCode.OK });
			return result;
		} catch (error: any) {
			span.recordException(error);
			span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
			throw error;
		} finally {
			span.end();
		}
	});
}

export function setSpanAttributes(attributes: Record<string, string | number | boolean>) {
	const activeSpan = trace.getActiveSpan();
	if (activeSpan) {
		activeSpan.setAttributes(attributes);
	}
}

export function addSpanEvent(name: string, attributes?: Record<string, string | number | boolean>) {
	const activeSpan = trace.getActiveSpan();
	if (activeSpan) {
		activeSpan.addEvent(name, attributes);
	}
} 