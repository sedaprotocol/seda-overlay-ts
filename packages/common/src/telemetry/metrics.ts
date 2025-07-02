/**
 * SEDA Overlay Custom Metrics
 * Comprehensive metrics based on error categorization analysis
 */

import { metrics } from '@opentelemetry/api';

// Get meter for custom metrics  
const meter = metrics.getMeter('seda-overlay-custom', '1.0.0');

/**
 * Custom metrics for SEDA Overlay observability
 * Based on error categorization analysis from todos_to_actionable_errors
 */
export const customMetrics = {
  // =================================================================
  // CRITICAL ERRORS - Immediate alerting required
  // =================================================================

  // CRITICAL-001: Node Boot Failures
  nodeBootFailures: meter.createCounter('overlay_node_boot_failures_total', {
    description: 'Total number of node boot failures',
    unit: '1',
  }),

  // CRITICAL-002: State Invariant Violations  
  stateInvariantViolations: meter.createCounter('overlay_state_invariant_violations_total', {
    description: 'Data request task state invariant violations',
    unit: '1',
  }),

  // CRITICAL-003: Duplicate Node Detection
  duplicateNodeErrors: meter.createCounter('overlay_duplicate_node_errors_total', {
    description: 'Duplicate node detection errors (reveal hash mismatch)',
    unit: '1',
  }),

  // CRITICAL-004: Staker Removal
  stakerRemovedErrors: meter.createCounter('overlay_staker_removed_errors_total', {
    description: 'Unexpected staker removal events',
    unit: '1',
  }),

  // CRITICAL-005: Identity Signing Failure
  identitySigningFailures: meter.createCounter('overlay_identity_signing_failures_total', {
    description: 'Identity signing failures with missing keys',
    unit: '1',
  }),

  // =================================================================
  // HIGH-PRIORITY RPC ERRORS - Alert after 3 consecutive in 30min
  // =================================================================

  // HIGH-RPC-001: General RPC Connection Issues
  rpcConnectionErrors: meter.createCounter('overlay_rpc_connection_errors_total', {
    description: 'RPC connection failures across the system',
    unit: '1',
  }),

  // HIGH-RPC-002: Data Request RPC Failures
  dataRequestRpcErrors: meter.createCounter('overlay_data_request_rpc_errors_total', {
    description: 'Data request specific RPC failures',
    unit: '1',
  }),

  // HIGH-RPC-003: Eligibility Check RPC Failures
  eligibilityRpcErrors: meter.createCounter('overlay_eligibility_rpc_errors_total', {
    description: 'Eligibility check RPC failures',
    unit: '1',
  }),

  // HIGH-RPC-004: Fetch Task RPC Failures
  fetchRpcErrors: meter.createCounter('overlay_fetch_rpc_errors_total', {
    description: 'Fetch task specific RPC failures',
    unit: '1',
  }),

  // =================================================================
  // HIGH-PRIORITY OTHER ERRORS - Immediate alerting
  // =================================================================

  // HIGH-001: Callback Message Issues
  callbackLookupFailures: meter.createCounter('overlay_callback_lookup_failures_total', {
    description: 'Callback message lookup failures - fishy behavior detected',
    unit: '1',
  }),

  // HIGH-002: Execution Result Missing
  executionResultMissing: meter.createCounter('overlay_execution_result_missing_total', {
    description: 'Missing execution results - should not be possible',
    unit: '1',
  }),

  // HIGH-003: Disk Write Failures
  diskWriteFailures: meter.createCounter('overlay_disk_write_failures_total', {
    description: 'Disk write failures for WASM cache',
    unit: '1',
  }),

  // HIGH-004: SEDA Transfer Failures
  sedaTransferFailures: meter.createCounter('overlay_seda_transfer_failures_total', {
    description: 'SEDA transfer failures (RPC or insufficient balance)',
    unit: '1',
  }),

  // HIGH-005: No Stake Available
  noStakeErrors: meter.createCounter('overlay_no_stake_errors_total', {
    description: 'No stake available for operations',
    unit: '1',
  }),

  // =================================================================
  // OPERATIONAL HEALTH METRICS
  // =================================================================

  // General application health
  errorTotal: meter.createCounter('overlay_errors_total', {
    description: 'Total application errors by type and severity',
    unit: '1',
  }),

  requestsTotal: meter.createCounter('overlay_requests_total', {
    description: 'Total application requests processed',
    unit: '1',
  }),

  dataRequestsProcessed: meter.createCounter('overlay_data_requests_processed_total', {
    description: 'Total data requests processed successfully',
    unit: '1',
  }),

  // Performance metrics
  operationDuration: meter.createHistogram('overlay_operation_duration_ms', {
    description: 'Duration of various operations in milliseconds',
    unit: 'ms',
  }),

  // Resource utilization
  memoryUsage: meter.createGauge('overlay_memory_usage_bytes', {
    description: 'Memory usage in bytes',
    unit: 'bytes',
  }),

  // RPC health tracking
  rpcRequestDuration: meter.createHistogram('overlay_rpc_request_duration_ms', {
    description: 'RPC request duration in milliseconds',
    unit: 'ms',
  }),

  rpcRequestsTotal: meter.createCounter('overlay_rpc_requests_total', {
    description: 'Total RPC requests by endpoint and status',
    unit: '1',
  }),
};

/**
 * Utility functions for incrementing metrics with consistent labeling
 */
export const metricsHelpers = {
  /**
   * Increment error counter with consistent labeling
   */
  incrementError(metric: ReturnType<typeof meter.createCounter>, error: Error, context?: Record<string, string>) {
    metric.add(1, {
      error_type: error.constructor.name,
      error_message: error.message.substring(0, 100), // Limit message length
      ...context,
    });
  },

  /**
   * Record operation duration with context
   */
  recordDuration(operation: string, durationMs: number, success: boolean, context?: Record<string, string>) {
    customMetrics.operationDuration.record(durationMs, {
      operation,
      success: success.toString(),
      ...context,
    });
  },

  /**
   * Increment RPC error with endpoint context
   */
  incrementRpcError(endpoint: string, error: Error) {
    customMetrics.rpcConnectionErrors.add(1, {
      endpoint,
      error_type: error.constructor.name,
    });
  },
};

/**
 * Export metrics for external registration if needed
 */
export default customMetrics; 