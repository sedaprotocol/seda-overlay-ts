# SEDA Overlay Telemetry System

Enterprise-grade OpenTelemetry instrumentation for SEDA Overlay with minimal code intrusion.

## 🚀 Quick Start

The telemetry system auto-initializes when imported. Simply use the decorators or utilities:

```typescript
import { Traced, MonitorCritical, customMetrics } from '@seda/common';

class DataProcessor {
  @Traced()
  async processData(data: any) {
    // Automatically traced with metrics
    return this.doWork(data);
  }

  @MonitorCritical('nodeBootFailures')
  async criticalOperation() {
    // Increments nodeBootFailures metric on error
    throw new Error('Boot failed');
  }
}
```

## 📊 Available Metrics

All 14 custom metrics from error categorization are ready:

### Critical Errors (Immediate Alerts)
- `overlay_node_boot_failures_total`
- `overlay_state_invariant_violations_total`
- `overlay_duplicate_node_errors_total`
- `overlay_staker_removed_errors_total`
- `overlay_identity_signing_failures_total`

### RPC Errors (3 consecutive = alert)
- `overlay_rpc_connection_errors_total`
- `overlay_data_request_rpc_errors_total`
- `overlay_eligibility_rpc_errors_total`
- `overlay_fetch_rpc_errors_total`

### High Priority Errors
- `overlay_callback_lookup_failures_total`
- `overlay_execution_result_missing_total`
- `overlay_disk_write_failures_total`
- `overlay_seda_transfer_failures_total`
- `overlay_no_stake_errors_total`

## 🎯 Usage Patterns

### 1. Decorators (Recommended)

```typescript
import { Traced, MonitorRPC, TraceClass } from '@seda/common';

@TraceClass()  // Traces all public methods
class StakingService {
  @Traced({ operationName: 'stake_delegation' })
  async delegateStake(amount: number) {
    // Custom operation name
  }

  @MonitorRPC('seda-chain')
  async sendTransaction() {
    // RPC monitoring with consecutive failure detection
  }
}
```

### 2. Manual Tracing

```typescript
import { traceOperation, SedaTracing, customMetrics } from '@seda/common';

// General operation tracing
const result = await traceOperation('data_processing', async () => {
  return processData();
});

// SEDA-specific tracing
await SedaTracing.traceDataRequest('dr_123', async () => {
  return handleDataRequest();
});

// Manual metric increments
customMetrics.nodeBootFailures.add(1, { 
  error_type: 'ConfigurationError',
  component: 'bootstrap' 
});
```

### 3. RPC Operations

```typescript
import { traceRPCOperation } from '@seda/common';

const chainData = await traceRPCOperation('seda-chain', 'getBlock', async () => {
  return await sedaChain.getBlock(height);
});
```

## ⚙️ Configuration

Control via environment variables:

```bash
# Enable telemetry (auto-enabled in production)
OTEL_ENABLED=true

# OTLP endpoint for traces and metrics
OTLP_ENDPOINT=http://localhost:4318/v1/traces

# Sample rate (0.0 to 1.0)
OTEL_SAMPLE_RATE=0.1

# Console logging for development
OTEL_LOG_CONSOLE=true

# Service identification
OTEL_SERVICE_NAME=seda-overlay
OTEL_SERVICE_VERSION=1.0.0-rc.22
```

## 🔍 Development

Enable console output to see telemetry locally:

```bash
OTEL_ENABLED=true OTEL_LOG_CONSOLE=true npm run dev
```

## 📈 Production

The system is optimized for production with:
- Batch processing for performance
- Configurable sampling rates
- Graceful shutdown handling
- Zero business logic impact

## 🎛️ Metrics Export

Metrics are exported in Prometheus format and include:
- Counter metrics for error tracking
- Histogram metrics for duration tracking  
- Gauge metrics for resource monitoring
- Custom labels for filtering and grouping

## 🔗 Integration

The telemetry system is designed to integrate with:
- Prometheus + Grafana for dashboards
- Jaeger for distributed tracing
- Any OTLP-compatible backend
- Custom alerting systems 