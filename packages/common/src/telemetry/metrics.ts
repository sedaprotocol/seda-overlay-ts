import { metrics } from "@opentelemetry/api";

// Lazy-loaded meter - will use the configured provider when first accessed
function getMeter() {
	return metrics.getMeter("seda-overlay-custom", "1.0.0");
}

// Lazy-loaded metrics - created on first access to ensure proper meter provider
let _sedaMetrics: any = null;

/**
 * Custom metrics for SEDA Overlay observability
 * Based on error categorization analysis from todos_to_actionable_errors
 */
export const sedaMetrics = new Proxy({} as any, {
	get(target, prop) {
		if (!_sedaMetrics) {
			const meter = getMeter();
			_sedaMetrics = {
				// =================================================================
				// CRITICAL ERRORS - Immediate alerting required
				// =================================================================

				// CRITICAL-001: Node Boot Failures
				nodeBootFailures: meter.createCounter("overlay_node_boot_failures_total", {
					description: "Total number of node boot failures",
					unit: "1",
				}),

				// CRITICAL-002: State Invariant Violations
				stateInvariantViolations: meter.createCounter("overlay_state_invariant_violations_total", {
					description: "Data request task state invariant violations",
					unit: "1",
				}),

				// CRITICAL-003: Duplicate Node Detection
				duplicateNodeErrors: meter.createCounter("overlay_duplicate_node_errors_total", {
					description: "Duplicate node detection errors (reveal hash mismatch)",
					unit: "1",
				}),

				// CRITICAL-004: Staker Removal
				stakerRemovedErrors: meter.createCounter("overlay_staker_removed_errors_total", {
					description: "Unexpected staker removal events",
					unit: "1",
				}),

				// CRITICAL-005: Identity Signing Failure
				identitySigningFailures: meter.createCounter("overlay_identity_signing_failures_total", {
					description: "Identity signing failures with missing keys",
					unit: "1",
				}),

				// =================================================================
				// HIGH-PRIORITY RPC ERRORS - Alert after 3 consecutive in 30min
				// =================================================================

				// HIGH-RPC-001: General RPC Connection Issues
				rpcConnectionErrors: meter.createCounter("overlay_rpc_connection_errors_total", {
					description: "RPC connection failures across the system",
					unit: "1",
				}),

				// HIGH-RPC-002: Data Request RPC Failures
				dataRequestRpcErrors: meter.createCounter("overlay_data_request_rpc_errors_total", {
					description: "Data request specific RPC failures",
					unit: "1",
				}),

				// HIGH-RPC-003: Eligibility Check RPC Failures
				eligibilityRpcErrors: meter.createCounter("overlay_eligibility_rpc_errors_total", {
					description: "Eligibility check RPC failures",
					unit: "1",
				}),

				// HIGH-RPC-004: Fetch Task RPC Failures
				fetchRpcErrors: meter.createCounter("overlay_fetch_rpc_errors_total", {
					description: "Fetch task specific RPC failures",
					unit: "1",
				}),

				// =================================================================
				// HIGH-PRIORITY OTHER ERRORS - Immediate alerting
				// =================================================================

				// HIGH-001: Callback Message Issues
				callbackLookupFailures: meter.createCounter("overlay_callback_lookup_failures_total", {
					description: "Callback message lookup failures - fishy behavior detected",
					unit: "1",
				}),

				// HIGH-002: Execution Result Missing
				executionResultMissing: meter.createCounter("overlay_execution_result_missing_total", {
					description: "Missing execution results - should not be possible",
					unit: "1",
				}),

				// HIGH-003: Disk Write Failures
				diskWriteFailures: meter.createCounter("overlay_disk_write_failures_total", {
					description: "Disk write failures for WASM cache",
					unit: "1",
				}),

				// HIGH-004: SEDA Transfer Failures
				sedaTransferFailures: meter.createCounter("overlay_seda_transfer_failures_total", {
					description: "SEDA transfer failures (RPC or insufficient balance)",
					unit: "1",
				}),

				// HIGH-005: No Stake Available
				noStakeErrors: meter.createCounter("overlay_no_stake_errors_total", {
					description: "No stake available for operations",
					unit: "1",
				}),

				// =================================================================
				// OPERATIONAL HEALTH METRICS
				// =================================================================

				// General application health
				errorTotal: meter.createCounter("overlay_errors_total", {
					description: "Total application errors by type and severity",
					unit: "1",
				}),

				requestsTotal: meter.createCounter("overlay_requests_total", {
					description: "Total application requests processed",
					unit: "1",
				}),

				dataRequestsProcessed: meter.createCounter("overlay_data_requests_processed_total", {
					description: "Total data requests processed successfully",
					unit: "1",
				}),

				// Performance metrics
				operationDuration: meter.createHistogram("overlay_operation_duration_ms", {
					description: "Duration of various operations in milliseconds",
					unit: "ms",
				}),

				// Resource utilization
				memoryUsage: meter.createGauge("overlay_memory_usage_bytes", {
					description: "Memory usage in bytes",
					unit: "bytes",
				}),

				// RPC health tracking
				rpcRequestDuration: meter.createHistogram("overlay_rpc_request_duration_ms", {
					description: "RPC request duration in milliseconds",
					unit: "ms",
				}),

				rpcRequestsTotal: meter.createCounter("overlay_rpc_requests_total", {
					description: "Total RPC requests by endpoint and status",
					unit: "1",
				}),

				// Connection metrics
				activeConnections: meter.createUpDownCounter("overlay_active_connections", {
					description: "Number of active connections by type",
					unit: "1",
				}),
			};
		}
		return _sedaMetrics[prop];
	},
});

/**
 * Common attributes to be used with all metrics for consistent labeling
 */
export function getCommonAttributes(additionalAttrs?: Record<string, string>) {
	return {
		service_name: "seda-overlay",
		service_version: process.env.OTEL_SERVICE_VERSION || "1.0.0",
		environment: process.env.NODE_ENV || "development",
		instance_id: process.env.INSTANCE_ID || `overlay-${Date.now()}`,
		...additionalAttrs,
	};
}

/**
 * Enhanced utility functions for recording metrics with consistent patterns
 */
export const metricsHelpers = {
	/**
	 * Record a critical error with proper categorization
	 */
	recordCriticalError(
		type: "node_boot" | "state_invariant" | "duplicate_node" | "staker_removed" | "identity_signing",
		error: Error,
		context?: Record<string, string>,
	) {
		const attributes = {
			...getCommonAttributes(),
			error_type: error.constructor.name,
			error_message: error.message.substring(0, 200),
			...context,
		};

		switch (type) {
			case "node_boot":
				sedaMetrics.nodeBootFailures.add(1, attributes);
				break;
			case "state_invariant":
				sedaMetrics.stateInvariantViolations.add(1, attributes);
				break;
			case "duplicate_node":
				sedaMetrics.duplicateNodeErrors.add(1, attributes);
				break;
			case "staker_removed":
				sedaMetrics.stakerRemovedErrors.add(1, attributes);
				break;
			case "identity_signing":
				sedaMetrics.identitySigningFailures.add(1, attributes);
				break;
		}

		// Also record in general errors counter
		sedaMetrics.errorTotal.add(1, { ...attributes, severity: "critical", category: type });
	},

	/**
	 * Record high-priority errors with categorization
	 */
	recordHighPriorityError(
		type: "callback_lookup" | "execution_result_missing" | "disk_write" | "seda_transfer" | "no_stake",
		error: Error,
		context?: Record<string, string>,
	) {
		const attributes = {
			...getCommonAttributes(),
			error_type: error.constructor.name,
			error_message: error.message.substring(0, 200),
			...context,
		};

		switch (type) {
			case "callback_lookup":
				sedaMetrics.callbackLookupFailures.add(1, attributes);
				break;
			case "execution_result_missing":
				sedaMetrics.executionResultMissing.add(1, attributes);
				break;
			case "disk_write":
				sedaMetrics.diskWriteFailures.add(1, attributes);
				break;
			case "seda_transfer":
				sedaMetrics.sedaTransferFailures.add(1, attributes);
				break;
			case "no_stake":
				sedaMetrics.noStakeErrors.add(1, attributes);
				break;
		}

		// Also record in general errors counter
		sedaMetrics.errorTotal.add(1, { ...attributes, severity: "high", category: type });
	},

	/**
	 * Record RPC error with endpoint categorization
	 */
	recordRpcError(
		type: "general" | "data_request" | "eligibility" | "fetch",
		endpoint: string,
		error: Error,
		context?: Record<string, string>,
	) {
		const attributes = {
			...getCommonAttributes(),
			endpoint,
			error_type: error.constructor.name,
			error_message: error.message.substring(0, 200),
			...context,
		};

		switch (type) {
			case "general":
				sedaMetrics.rpcConnectionErrors.add(1, attributes);
				break;
			case "data_request":
				sedaMetrics.dataRequestRpcErrors.add(1, attributes);
				break;
			case "eligibility":
				sedaMetrics.eligibilityRpcErrors.add(1, attributes);
				break;
			case "fetch":
				sedaMetrics.fetchRpcErrors.add(1, attributes);
				break;
		}

		// Also record in general RPC metrics
		sedaMetrics.errorTotal.add(1, { ...attributes, severity: "high", category: "rpc_error" });
	},

	/**
	 * Record RPC operation with timing and error tracking
	 */
	recordRpcOperation(
		endpoint: string,
		duration: number,
		success: boolean,
		error?: Error,
		context?: Record<string, string>,
	) {
		const attributes = {
			...getCommonAttributes(),
			rpc_endpoint: endpoint,
			success: success.toString(),
			...context,
		};

		// Record duration
		sedaMetrics.rpcRequestDuration.record(duration, attributes);

		// Record request count
		sedaMetrics.rpcRequestsTotal.add(1, attributes);

		if (!success && error) {
			// Record RPC error
			sedaMetrics.rpcConnectionErrors.add(1, {
				...attributes,
				error_type: error.constructor.name,
				error_message: error.message.substring(0, 200),
			});
		}
	},

	/**
	 * Record data request stage progression
	 */
	recordDataRequestStage(
		drId: string,
		stage: "execute" | "commit" | "reveal" | "completed" | "failed",
		duration?: number,
		context?: Record<string, string>,
	) {
		const attributes = {
			...getCommonAttributes(),
			dr_id: drId,
			stage,
			...context,
		};

		sedaMetrics.dataRequestsProcessed.add(1, attributes);

		if (duration !== undefined) {
			sedaMetrics.operationDuration.record(duration, attributes);
		}

		if (stage === "completed") {
			sedaMetrics.dataRequestsProcessed.add(1, attributes);
		}
	},

	/**
	 * Record general operation with timing
	 */
	recordOperation(operationType: string, duration: number, success: boolean, context?: Record<string, string>) {
		const attributes = {
			...getCommonAttributes(),
			operation_type: operationType,
			success: success.toString(),
			...context,
		};

		sedaMetrics.operationDuration.record(duration, attributes);
		sedaMetrics.requestsTotal.add(1, attributes);
	},

	/**
	 * Update resource metrics
	 */
	updateResourceMetrics() {
		if (typeof process !== "undefined" && process.memoryUsage) {
			const memUsage = process.memoryUsage();
			const attributes = getCommonAttributes();

			sedaMetrics.memoryUsage.record(memUsage.heapUsed, { ...attributes, memory_type: "heap_used" });
			sedaMetrics.memoryUsage.record(memUsage.heapTotal, { ...attributes, memory_type: "heap_total" });
			sedaMetrics.memoryUsage.record(memUsage.rss, { ...attributes, memory_type: "rss" });
		}
	},

	/**
	 * Track connection changes
	 */
	updateConnectionCount(type: string, delta: number, context?: Record<string, string>) {
		const attributes = {
			...getCommonAttributes(),
			connection_type: type,
			...context,
		};

		sedaMetrics.activeConnections.add(delta, attributes);
	},
};

/**
 * Start periodic collection of system metrics
 */
export function startSystemMetricsCollection(intervalMs = 30000) {
	const interval = setInterval(() => {
		metricsHelpers.updateResourceMetrics();
	}, intervalMs);

	// Return cleanup function
	return () => clearInterval(interval);
}

// Export individual metrics for specific use cases
export const { dataRequestsProcessed, operationDuration, rpcRequestDuration, errorTotal, activeConnections } =
	sedaMetrics;
