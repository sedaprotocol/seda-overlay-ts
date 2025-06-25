# SEDA Overlay Node: gRPC Block Monitoring Implementation Plan

## Executive Summary

This plan outlines the transition from RPC-intensive polling to gRPC block monitoring for the SEDA overlay node. The current implementation polls for data requests, commits, and reveals individually, causing significant RPC load. The new approach will monitor blocks in real-time through gRPC, parse transactions as they occur, and react to relevant events.

## Current Architecture Analysis

### Current Flow (RPC-Intensive)
1. **FetchTask** - Polls for pending data requests every 1 second
2. **EligibilityTask** - Checks eligibility every 3 seconds
3. **DataRequestTask** - Polls individual DR status every 2.5 seconds
4. **CommitTask** - Waits for transaction confirmation via polling
5. **RevealTask** - Polls for reveal readiness

### Problems with Current Approach
- Extremely RPC call intensive (multiple nodes polling same endpoints)
- Delay in discovering new data requests
- Inefficient transaction monitoring
- Scalability issues with many overlay nodes

## New Architecture: gRPC Block Monitoring

### New Flow (Transaction Argument-Driven)
1. **BlockMonitorTask** - Monitor latest blocks via gRPC streaming every second
2. **TransactionParser** - Parse all transactions in new blocks and extract message arguments
3. **EventProcessor** - Process relevant SEDA transactions by parsing message arguments (NOT blockchain events)
4. **StateMachine** - Manage DR lifecycle based on observed transaction arguments

**CRITICAL ARCHITECTURAL DECISION**: 
- We do NOT use blockchain events for data extraction
- All data request attributes (DR ID, replication factor, gas limits, etc.) are derived directly from transaction message arguments
- This is because events are not available in the getBlock query and are less reliable
- The `message.value` field contains all the transaction arguments we need to parse
- Focus on parsing `post_data_request`, `commit_data_result`, and `reveal_data_result` message arguments

### Data Extraction Strategy from Transaction Arguments

For `post_data_request` transactions:
- Extract: `exec_program_id`, `exec_inputs`, `exec_gas_limit`, `tally_program_id`, `tally_inputs`, `tally_gas_limit`, `replication_factor`, `consensus_filter`, `gas_price`, `memo`
- Generate DR ID using DataRequestIdGenerator from these arguments
- Derive all DR attributes directly from message arguments

For `commit_data_result` transactions:
- Extract: `data_request_id`, `commitment`, `public_key` from message arguments
- Track commits by DR ID and public key

For `reveal_data_result` transactions:
- Extract: `data_request_id`, `public_key`, `reveal_data` from message arguments
- Track reveals and determine completion status

## Implementation Plan

### Phase 1: Core Infrastructure (Week 1-2)

#### 1.1 gRPC Block Monitoring Service
**File**: `packages/node/src/services/block-monitor.ts`

```typescript
interface BlockEvent {
  height: bigint;
  block: Block;
  blockResults: BlockResultsResponse;
  transactions: ParsedTransaction[];
}

interface ParsedTransaction {
  hash: string;
  success: boolean;
  messages: ParsedMessage[];
  // NOTE: We do NOT use blockchain events - all data derived from message arguments
}

interface ParsedMessage {
  typeUrl: string;
  value: any; // Decoded message arguments (this is where we extract all DR data)
  sedaContext?: SedaMessageContext;
}

interface SedaMessageContext {
  type: 'post_data_request' | 'commit_data_result' | 'reveal_data_result';
  drId?: string;
  commitmentHash?: string;
  publicKey?: string;
}

class BlockMonitorService {
  async startMonitoring(): Promise<void>
  async getLatestBlock(): Promise<BlockEvent>
  on(event: 'newBlock', handler: (blockEvent: BlockEvent) => void): void
}
```

#### 1.2 Transaction Parser
**File**: `packages/node/src/services/transaction-parser.ts`

```typescript
class TransactionParser {
  parseBlock(block: Block, blockResults: BlockResultsResponse): ParsedTransaction[]
  parseSedaMessage(message: Any): ParsedMessage | null
  extractDataRequestId(message: ParsedMessage): string | null
  extractDataRequestAttributes(message: ParsedMessage): DataRequestAttributes | null
  isSuccessfulTransaction(txResult: ExecTxResult): boolean
  
  // NOTE: All DR attributes extracted from message.value (transaction arguments)
  // NOT from blockchain events which are unreliable and not in getBlock query
}
```

#### 1.3 Update gRPC Client Configuration
**File**: `packages/common/src/seda/query-client.ts`

Add block monitoring capabilities:
```typescript
export async function createBlockMonitorClient(rpc: string) {
  const cometClient = await Comet38Client.connect(rpc);
  return {
    getLatestBlock: () => cometClient.block(),
    getBlockResults: (height: number) => cometClient.blockResults(height),
    subscribeNewBlocks: () => cometClient.subscribeTm({ query: "tm.event = 'NewBlock'" })
  };
}
```

### Phase 2: Event Processing Engine (Week 3-4)

#### 2.1 Event Processor
**File**: `packages/node/src/services/event-processor.ts`

```typescript
interface DataRequestEvent {
  type: 'posted' | 'committed' | 'revealed';
  drId: string;
  height: bigint;
  txHash: string;
  data: any;
}

class EventProcessor {
  async processBlockTransactions(blockEvent: BlockEvent): Promise<DataRequestEvent[]>
  private extractPostDataRequestFromTx(tx: ParsedTransaction): DataRequestEvent[]
  private extractCommitFromTx(tx: ParsedTransaction): DataRequestEvent[]
  private extractRevealFromTx(tx: ParsedTransaction): DataRequestEvent[]
  
  // NOTE: All data extracted from transaction message arguments, NOT blockchain events
  // Parse message.value to get all required DR attributes
}
```

#### 2.2 DR ID Generation Service
**File**: `packages/node/src/services/dr-id-generator.ts`

```typescript
class DataRequestIdGenerator {
  // Need implementation details from user
  generateDrId(postDataRequestMsg: any): string
  
  // Fallback: derive from transaction hash and message index
  deriveDrIdFromTx(txHash: string, msgIndex: number): string
}
```

**NOTE**: Need clarification on DR ID generation algorithm. Current implementation uses provided IDs from contract queries.

#### 2.3 Data Request State Manager
**File**: `packages/node/src/models/data-request-state-manager.ts`

```typescript
interface TrackedDataRequest {
  drId: string;
  height: bigint;
  replicationFactor: number;
  successfulCommits: Set<string>; // public keys
  isEligible: boolean;
  eligibilityHeight?: bigint;
  executionResult?: ExecutionResult;
  commitHash?: Buffer;
  status: 'posted' | 'executing' | 'committed' | 'revealing' | 'revealed' | 'completed';
}

class DataRequestStateManager {
  private trackedRequests: Map<string, TrackedDataRequest> = new Map();
  
  addDataRequest(drId: string, details: any): void
  addCommit(drId: string, publicKey: string): void
  addReveal(drId: string, publicKey: string): void
  isReadyForReveal(drId: string): boolean
  shouldCleanup(drId: string): boolean
  getTrackedRequest(drId: string): TrackedDataRequest | undefined
}
```

### Phase 3: Block Monitoring Task (Week 5-6)

#### 3.1 Main Block Monitor Task
**File**: `packages/node/src/tasks/block-monitor.ts`

```typescript
export class BlockMonitorTask extends EventEmitter<EventMap> {
  private blockMonitor: BlockMonitorService;
  private eventProcessor: EventProcessor;
  private stateManager: DataRequestStateManager;
  private eligibilityChecker: EligibilityChecker;
  private lastProcessedHeight: bigint = 0n;

  async start(): Promise<void>
  private async processNewBlock(blockEvent: BlockEvent): Promise<void>
  private async handleDataRequestPosted(event: DataRequestEvent): Promise<void>
  private async handleCommitReceived(event: DataRequestEvent): Promise<void>
  private async handleRevealReceived(event: DataRequestEvent): Promise<void>
}
```

#### 3.2 Eligibility Checker (Modified)
**File**: `packages/node/src/services/eligibility-checker.ts`

```typescript
class EligibilityChecker {
  async checkEligibilityForNewDR(
    drId: string, 
    drDetails: any, 
    height: bigint
  ): Promise<Map<string, bigint>> // identityId -> eligibilityHeight
  
  // Keep existing offline eligibility calculation
  private async calculateOfflineEligibility(
    drId: string,
    drDetails: any,
    height: bigint
  ): Promise<Map<string, bigint>>
}
```

### Phase 4: Migration Strategy and Integration (Week 7-8)

#### 4.1 Add Migration Configuration
**File**: `packages/config/src/models/node-config.ts`

```typescript
export interface NodeConfig {
  // Add experimental block monitoring config
  experimental: {
    useBlockMonitoring: boolean; // Feature flag - default false
    fallbackToRpc: boolean; // Fallback if gRPC fails - default true
    hybridMode: boolean; // Run both systems in parallel for testing - default false
  };
  
  blockMonitoring: {
    enabled: boolean; // Internal flag set by experimental.useBlockMonitoring
    pollInterval: number; // milliseconds, default 1000
    maxBlockHistory: number; // blocks to keep in memory, default 100
    grpcTimeout: number; // milliseconds, default 5000
  };
  
  // Keep existing RPC polling config for fallback
  // drFetchLimit, fetchFailureThreshold, etc.
}
```

#### 4.2 Update Main Task with Dual Mode Support
**File**: `packages/node/src/tasks/main.ts`

```typescript
export class MainTask {
  // New gRPC block monitoring system
  private blockMonitorTask?: BlockMonitorTask;
  private dataRequestExecutor?: DataRequestExecutor;
  
  // Existing RPC polling system (keep for fallback)
  private fetchTask: FetchTask;
  private eligibilityTask: EligibilityTask;
  
  // Shared components
  private identityManagerTask: IdentityManagerTask;
  public identityPool: IdentityPool;
  
  async start() {
    await this.identityManagerTask.start();
    
    if (this.config.experimental.useBlockMonitoring) {
      logger.info("🚀 Starting with gRPC block monitoring");
      await this.startBlockMonitoring();
      
      if (this.config.experimental.hybridMode) {
        logger.info("🔄 Hybrid mode: also starting RPC polling for comparison");
        await this.startRpcPolling();
      }
    } else {
      logger.info("📡 Starting with RPC polling (legacy mode)");
      await this.startRpcPolling();
    }
  }
  
  private async startBlockMonitoring() {
    this.blockMonitorTask = new BlockMonitorTask(/* ... */);
    this.dataRequestExecutor = new DataRequestExecutor(/* ... */);
    
    await this.blockMonitorTask.start();
    
    // Handle events from block monitoring
    this.blockMonitorTask.on('eligible', this.handleEligibleDR.bind(this));
    this.blockMonitorTask.on('readyForReveal', this.handleReadyForReveal.bind(this));
    this.blockMonitorTask.on('error', this.handleBlockMonitorError.bind(this));
  }
  
  private async startRpcPolling() {
    this.fetchTask.start();
    
    this.fetchTask.on("data-request", (_dataRequest) => {
      this.eligibilityTask.process();
    });

    this.eligibilityTask.on("eligible", this.handleEligibleDR.bind(this));
  }
  
  private async handleBlockMonitorError(error: Error) {
    logger.error("Block monitoring failed", { error: error.message });
    
    if (this.config.experimental.fallbackToRpc) {
      logger.warn("🔄 Falling back to RPC polling");
      await this.startRpcPolling();
    }
  }
}
```

#### 4.2 Data Request Executor
**File**: `packages/node/src/services/data-request-executor.ts`

```typescript
class DataRequestExecutor {
  async executeAndCommit(
    drId: string,
    drDetails: any,
    identityId: string,
    eligibilityHeight: bigint
  ): Promise<void>
  
  async reveal(
    drId: string,
    identityId: string
  ): Promise<void>
}
```

### Phase 5: Configuration and Testing (Week 9-10)

#### 5.1 Configuration Updates
**File**: `packages/config/src/models/node-config.ts`

```typescript
export interface NodeConfig {
  // Remove: drFetchLimit, fetchFailureThreshold
  // Add:
  blockMonitoring: {
    enabled: boolean;
    pollInterval: number; // milliseconds, default 1000
    maxBlockHistory: number; // blocks to keep in memory, default 100
    grpcTimeout: number; // milliseconds, default 5000
  };
  
  // Keep existing: maxConcurrentRequests, etc.
}
```

#### 5.2 Update Constants
**File**: `packages/config/src/constants.ts`

```typescript
// Remove: DEFAULT_FETCH_TASK_INTERVAL, DEFAULT_ELIGIBILITY_CHECK_INTERVAL
// Add:
export const DEFAULT_BLOCK_MONITOR_INTERVAL = 1000; // 1 second
export const DEFAULT_MAX_BLOCK_HISTORY = 100;
export const DEFAULT_GRPC_TIMEOUT = 5000;
```

#### 5.3 Interval Configuration Updates
**File**: `packages/config/src/models/intervals-config.ts`

```typescript
export const IntervalsConfigSchema = v.object({
  // Remove: fetchTask, eligibilityCheck
  blockMonitor: v.optional(v.number(), DEFAULT_BLOCK_MONITOR_INTERVAL),
  identityCheck: v.optional(v.number(), DEFAULT_IDENTITY_CHECK_INTERVAL),
  statusCheck: v.optional(v.number(), DEFAULT_STATUS_CHECK_INTERVAL),
  drTask: v.optional(v.number(), DEFAULT_DR_TASK_INTERVAL),
});
```

### Phase 6: Data Request ID Generation (Implementation Ready)

**IMPLEMENTATION**: Based on the reference `createDataRequestId` function from the solver SDK.

**File**: `packages/node/src/services/dr-id-generator.ts`

```typescript
import { Keccak256, keccak256 } from "@cosmjs/crypto";
import { BN } from "bn.js";

interface DataRequest {
  version: string;
  execProgramId: string;
  execInputs: Buffer;
  tallyProgramId: string;
  tallyInputs: Buffer;
  replicationFactor: number;
  consensusFilter: Buffer;
  gasPrice: bigint;
  execGasLimit: bigint;
  tallyGasLimit: bigint;
  memo: Buffer;
  paybackAddress: Buffer;
}

class DataRequestIdGenerator {
  /**
   * Generate DR ID from post_data_request message parameters
   * Based on reference implementation in solver-sdk
   */
  generateDrId(postDrMsg: {
    version: string;
    exec_program_id: string;
    exec_inputs: string; // base64 encoded
    exec_gas_limit: number;
    tally_program_id: string;
    tally_inputs: string; // base64 encoded
    tally_gas_limit: number;
    replication_factor: number;
    consensus_filter: string; // base64 encoded
    gas_price: string;
    memo: string; // base64 encoded
  }): string {
    // Convert from PostDataRequestArgs format to DataRequest format
    const dr: DataRequest = {
      version: postDrMsg.version,
      execProgramId: postDrMsg.exec_program_id,
      execInputs: Buffer.from(postDrMsg.exec_inputs, 'base64'),
      tallyProgramId: postDrMsg.tally_program_id,
      tallyInputs: Buffer.from(postDrMsg.tally_inputs, 'base64'),
      replicationFactor: postDrMsg.replication_factor,
      consensusFilter: Buffer.from(postDrMsg.consensus_filter, 'base64'),
      gasPrice: BigInt(postDrMsg.gas_price),
      execGasLimit: BigInt(postDrMsg.exec_gas_limit),
      tallyGasLimit: BigInt(postDrMsg.tally_gas_limit),
      memo: Buffer.from(postDrMsg.memo, 'base64'),
      paybackAddress: Buffer.alloc(0), // Not used in ID calculation
    };

    return this.createDataRequestId(dr);
  }

  /**
   * Core DR ID creation algorithm - matches solver SDK implementation
   */
  private createDataRequestId(dr: DataRequest): string {
    // Hash non-fixed-length inputs
    const drInputsHash = keccak256(dr.execInputs);
    const tallyInputsHash = keccak256(dr.tallyInputs);
    const consensusFilterHash = keccak256(dr.consensusFilter);
    const memoHash = keccak256(dr.memo);
    const versionHash = keccak256(Buffer.from(dr.version));

    // Convert fixed-length values to buffers with specific byte lengths
    const replicationFactor = new BN(dr.replicationFactor).toBuffer("be", 2); // 2 bytes for 16-bit
    const gasPrice = new BN(dr.gasPrice.toString()).toBuffer("be", 16); // 16 bytes for 128-bit
    const execGasLimit = new BN(dr.execGasLimit.toString()).toBuffer("be", 8); // 8 bytes for 64-bit
    const tallyGasLimit = new BN(dr.tallyGasLimit.toString()).toBuffer("be", 8); // 8 bytes for 64-bit

    // Hash the data request in the correct order
    const drHasher = new Keccak256();
    
    drHasher.update(versionHash);
    drHasher.update(Buffer.from(dr.execProgramId, "hex"));
    drHasher.update(drInputsHash);
    drHasher.update(execGasLimit);
    drHasher.update(Buffer.from(dr.tallyProgramId, "hex"));
    drHasher.update(tallyInputsHash);
    drHasher.update(tallyGasLimit);
    drHasher.update(replicationFactor);
    drHasher.update(consensusFilterHash);
    drHasher.update(gasPrice);
    drHasher.update(memoHash);

    return Buffer.from(drHasher.digest()).toString("hex");
  }
}
```

**Dependencies to Add**:
- `@cosmjs/crypto` (likely already present)
- `bn.js` for big number handling

**Notes**:
- DR ID is deterministic based on request parameters only
- Implementation matches the reference from solver SDK
- No dependency on transaction hash or block height
- Supports offline ID generation for eligibility calculation

### Phase 7: Testing and Migration (Week 11-12)

#### 7.1 Integration Tests
```typescript
// packages/node/src/tasks/__tests__/block-monitor.test.ts
describe('BlockMonitorTask', () => {
  it('should detect new data requests', async () => {
    // Mock block with post_data_request transaction
    // Verify eligibility check triggered
    // Verify execution started for eligible identities
  });

  it('should track commits and trigger reveals', async () => {
    // Mock blocks with commit transactions
    // Verify state tracking
    // Verify reveal triggered when replication factor met
  });

  it('should cleanup completed requests', async () => {
    // Mock complete DR lifecycle
    // Verify cleanup after all reveals received
  });
});
```

#### 7.2 Migration Strategy - Step by Step

**Phase A: Development Integration (Week 11)**
1. **Implement dual mode support** in MainTask with feature flags
2. **Add configuration options** for experimental.useBlockMonitoring
3. **Default to RPC polling** (useBlockMonitoring = false) for safety
4. **Test both systems** can coexist without conflicts

**Phase B: Testing and Validation (Week 11)**
1. **Enable hybrid mode** (both systems running in parallel)
2. **Compare results** between RPC polling and block monitoring
3. **Validate DR discovery** timing and accuracy 
4. **Test failover** from gRPC to RPC when gRPC fails
5. **Performance testing** with RPC call reduction metrics

**Phase C: Gradual Rollout (Week 12)**
1. **Enable block monitoring** on test/staging environments
2. **Monitor for 24+ hours** to ensure stability
3. **Gradual production rollout** with immediate rollback capability
4. **Phased user adoption** with configuration flags

**Phase D: Full Migration (Future)**
1. **Default to block monitoring** after proven stable
2. **Keep RPC polling** as fallback for reliability
3. **Eventually deprecate** RPC polling code paths
4. **Remove legacy code** after confidence period

#### 7.3 Configuration for Migration
```typescript
export interface NodeConfig {
  experimental: {
    useBlockMonitoring: boolean; // Feature flag
    fallbackToRpc: boolean; // Fallback if gRPC fails
  };
}
```

## Implementation Timeline

| Week | Phase | Deliverables |
|------|-------|-------------|
| 1-2 | Core Infrastructure | BlockMonitorService, TransactionParser, gRPC client updates |
| 3-4 | Event Processing | EventProcessor, DataRequestStateManager, EligibilityChecker |
| 5-6 | Block Monitoring | BlockMonitorTask, integration with event processing |
| 7-8 | Migration Strategy | Dual mode MainTask, feature flags, fallback system |
| 9-10 | Configuration & Testing | Config updates, unit tests, integration tests |
| 11-12 | Deployment & Migration | Testing, validation, gradual rollout with RPC fallback |

**CRITICAL**: The system will continue to use RPC polling by default until explicitly enabled via `experimental.useBlockMonitoring = true`. This ensures zero disruption during development and allows for safe testing.

### How to Test the New System

**Option 1: gRPC Block Monitoring Only**
```json
{
  "experimental": {
    "useBlockMonitoring": true,
    "fallbackToRpc": false,
    "hybridMode": false
  }
}
```

**Option 2: Hybrid Mode (Both Systems)**
```json
{
  "experimental": {
    "useBlockMonitoring": true,
    "fallbackToRpc": true,
    "hybridMode": true
  }
}
```

**Option 3: Legacy RPC Polling (Default)**
```json
{
  "experimental": {
    "useBlockMonitoring": false,
    "fallbackToRpc": true,
    "hybridMode": false
  }
}
```

## Git Commit Strategy

Create commits after each major milestone:

1. **Phase 1 completion**: `feat: implement BlockMonitorService and gRPC client updates`
2. **Phase 2 completion**: `feat: implement TransactionParser with SEDA message parsing`
3. **Phase 3 completion**: `feat: implement EventProcessor and DataRequestStateManager`
4. **Phase 4 completion**: `feat: implement EligibilityChecker with offline DR ID generation`
5. **Phase 5 completion**: `feat: implement BlockMonitorTask with event processing integration`
6. **Phase 6 completion**: `feat: add DataRequestIdGenerator with reference implementation`
7. **Phase 7 completion**: `feat: implement dual-mode MainTask with gRPC/RPC fallback system`
8. **Phase 8 completion**: `feat: implement DataRequestExecutor and migration configuration`
9. **Phase 9 completion**: `feat: update configuration and add comprehensive tests`
10. **Phase 10 completion**: `test: add integration tests and performance benchmarks`
11. **Phase 11 completion**: `feat: implement dual-mode migration with feature flags`
12. **Phase 12 completion**: `feat: complete gRPC block monitoring migration`

## Benefits After Implementation

1. **Reduced RPC Load**: ~90% reduction in RPC calls
2. **Faster Response**: Near real-time detection of transactions
3. **Better Scalability**: Supports many overlay nodes without RPC overload
4. **Improved Reliability**: Less dependent on RPC stability and blockchain events
5. **Cleaner Architecture**: Transaction argument-driven vs polling-based
6. **More Reliable**: Direct parsing of transaction arguments vs unreliable events

## Dependencies and Questions

### Critical Dependencies
1. **DR ID Generation Algorithm**: Need reference implementation
2. **gRPC Block Streaming**: Verify Cosmos SDK version compatibility
3. **Transaction Parsing**: Ensure we can decode SEDA-specific messages

### Questions for Review
1. How is the data request ID generated from post_data_request message parameters?
2. Should we maintain backward compatibility with RPC polling as fallback?
3. What's the desired behavior if gRPC connection fails?
4. Are there any SEDA-specific transaction events we should monitor?

## Testing Strategy

1. **Unit Tests**: Each service/class individually
2. **Integration Tests**: Full block processing pipeline
3. **Load Tests**: Multiple overlay nodes with high transaction volume
4. **Chaos Testing**: Network failures, RPC outages
5. **Performance Testing**: Memory usage, CPU usage, response times

## Monitoring and Metrics

Add the following metrics:
- Block processing latency
- Transaction parsing success rate
- Data request discovery time
- RPC call count (should decrease dramatically)
- gRPC connection health
- Event processing queue depth

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| gRPC Connection Failure | High | Fallback to RPC polling |
| DR ID Generation Issues | High | Query chain as fallback |
| Block Processing Lag | Medium | Async processing, queuing |
| Memory Usage Growth | Medium | Periodic cleanup, bounded history |
| Transaction Parsing Errors | Medium | Graceful error handling, logging |

## Success Criteria

1. ✅ 90%+ reduction in RPC calls
2. ✅ Sub-second detection of new data requests
3. ✅ Zero data request processing failures
4. ✅ Successful migration of all existing functionality
5. ✅ Improved system scalability metrics

---

This plan provides a comprehensive roadmap for transitioning the SEDA overlay node from RPC polling to gRPC block monitoring, resulting in a more efficient, scalable, and responsive system. 