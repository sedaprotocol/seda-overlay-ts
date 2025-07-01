import { logger } from "@sedaprotocol/overlay-ts-logger";
import { EventEmitter } from "eventemitter3";
import { Result } from "true-myth";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import type { SedaChain } from "@sedaprotocol/overlay-ts-common";
import { BlockMonitorService, type BlockEvent } from "../services/block-monitor";
import { EventProcessor, type DataRequestEvent } from "../services/event-processor";
import { DataRequestStateManager, type TrackedDataRequest } from "../models/data-request-state-manager";
import { EligibilityChecker } from "../services/eligibility-checker";
import type { IdentityPool } from "../models/identitiest-pool";
import type { DataRequestPool } from "../models/data-request-pool";
import { getDataRequest } from "../services/get-data-requests";

type EventMap = {
  eligible: [drId: string, identityIds: string[], eligibilityHeight: bigint];
  readyForReveal: [drId: string, identityIds: string[]];
  revealConfirmed: [drId: string, identityId: string];
  completed: [drId: string];
  error: [Error];
};

export class BlockMonitorTask extends EventEmitter<EventMap> {
  private blockMonitor: BlockMonitorService;
  private eventProcessor: EventProcessor;
  private stateManager: DataRequestStateManager;
  private eligibilityChecker: EligibilityChecker;
  private identityPool: IdentityPool;
  private pool: DataRequestPool;
  private isRunning = false;
  private lastProcessedHeight: bigint = 0n;

  constructor(
    private config: AppConfig,
    private sedaChain: SedaChain,
    identityPool: IdentityPool,
    pool: DataRequestPool,
    private mainTask?: any, // Reference to main task for direct task termination
  ) {
    super();
    this.identityPool = identityPool;
    this.pool = pool;
    this.blockMonitor = new BlockMonitorService(config);
    this.eventProcessor = new EventProcessor(sedaChain);
    this.stateManager = new DataRequestStateManager();
    this.eligibilityChecker = new EligibilityChecker(sedaChain);
    
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Block monitor events
    this.blockMonitor.on('newBlock', this.handleNewBlock.bind(this));
    this.blockMonitor.on('error', this.handleBlockMonitorError.bind(this));
    
    // State manager events
    this.stateManager.on('readyForReveal', (drId, identityIds) => {
      this.emit('readyForReveal', drId, identityIds);
    });
    
    this.stateManager.on('completed', (drId) => {
      this.emit('completed', drId);
    });
    
    this.stateManager.on('statusChanged', (drId, oldStatus, newStatus) => {
      logger.debug(`DR ${drId} status changed: ${oldStatus} → ${newStatus}`);
    });
  }

  /**
   * Start the block monitoring task
   */
  async start(): Promise<Result<void, Error>> {
    if (this.isRunning) {
      return Result.ok(undefined);
    }

    logger.info("Starting gRPC block monitoring task");

    const startResult = await this.blockMonitor.startMonitoring();
    if (startResult.isErr) {
      return Result.err(startResult.error);
    }

    this.isRunning = true;
    logger.info("Block monitoring task started successfully");
    return Result.ok(undefined);
  }

  /**
   * Stop the block monitoring task
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info("Stopping block monitoring task");
    this.isRunning = false;
    
    await this.blockMonitor.stopMonitoring();
    this.stateManager.destroy();
    
    logger.info("Block monitoring task stopped");
  }

  /**
   * Handle new block events and process DR events - NON-BLOCKING for ongoing processes
   */
  private async handleNewBlock(blockEvent: BlockEvent): Promise<void> {
    const height = blockEvent.height;
    this.lastProcessedHeight = height;

    // Process block in background without blocking ongoing operations
    setImmediate(async () => {
      try {
        logger.debug(`Processing block ${height} with ${blockEvent.transactions.length} transactions`);
        
        // Extract all DR events from the block  
        const events = await this.eventProcessor.processBlockTransactions(blockEvent);
        
        if (events.length === 0) {
          logger.debug(`No DR events found in block ${height}`);
          return;
        }

        logger.debug(`Found ${events.length} DR events in block ${height}`);

        // Group events by type for batch processing
        const postEvents = events.filter(e => e.type === 'posted');
        const commitEvents = events.filter(e => e.type === 'committed');  
        const revealEvents = events.filter(e => e.type === 'revealed');

        // Process all events in parallel WITHOUT blocking other processes
        const processingPromises: Promise<void>[] = [];

        // Process all posted DRs in parallel
        if (postEvents.length > 0) {
          logger.info(`📬 Processing ${postEvents.length} posted DR events from block ${height} (non-blocking)`);
          for (const event of postEvents) {
            // Use setImmediate for each event to ensure no blocking
            processingPromises.push(
              new Promise<void>((resolve) => {
                setImmediate(async () => {
                  try {
                    await this.handleDataRequestPosted(event, height);
                    resolve();
                  } catch (error) {
                    logger.error(`Error processing posted DR event: ${error}`);
                    resolve(); // Continue processing other events
                  }
                });
              })
            );
          }
        }

        // Process all commits in parallel  
        if (commitEvents.length > 0) {
          logger.info(`📝 Processing ${commitEvents.length} commit events from block ${height} (non-blocking)`);
          for (const event of commitEvents) {
            processingPromises.push(
              new Promise<void>((resolve) => {
                setImmediate(async () => {
                  try {
                    await this.handleDataRequestCommitted(event, height);
                    resolve();
                  } catch (error) {
                    logger.error(`Error processing commit event: ${error}`);
                    resolve(); // Continue processing other events
                  }
                });
              })
            );
          }
        }

        // Process all reveals in parallel
        if (revealEvents.length > 0) {
          logger.info(`🎯 Processing ${revealEvents.length} reveal events from block ${height} (non-blocking)`);
          for (const event of revealEvents) {
            processingPromises.push(
              new Promise<void>((resolve) => {
                setImmediate(async () => {
                  try {
                    await this.handleDataRequestRevealed(event, height);
                    resolve();
                  } catch (error) {
                    logger.error(`Error processing reveal event: ${error}`);
                    resolve(); // Continue processing other events
                  }
                });
              })
            );
          }
        }

        // Process all events in background - don't block other operations
        Promise.all(processingPromises).then(() => {
          logger.debug(`✅ Completed processing block ${height} - ${postEvents.length} posts, ${commitEvents.length} commits, ${revealEvents.length} reveals`);
        }).catch((error) => {
          logger.error(`Error in block ${height} processing: ${error}`);
        });

      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error(`Failed to process block ${height}: ${err.message}`);
      }
    });

    // Return immediately without waiting for processing to complete
    logger.debug(`📦 Block ${height} queued for background processing, ongoing operations continue`);
  }

  /**
   * Handle a new data request posted on the chain
   */
  private async handleDataRequestPosted(event: DataRequestEvent, height: bigint): Promise<void> {
    const { drId, data } = event;
    
    try {
      // Check if we're already tracking this DR (only same DR ID is considered duplicate)
      if (this.stateManager.getTrackedRequest(drId)) {
        logger.warn(`Data request ${drId} already being tracked, skipping duplicate processing`);
        return;
      }

      logger.info(`📬 New DR posted: ${drId} (replication: ${data.replicationFactor})`);

      // Add to state manager for tracking - use data from event directly
      this.stateManager.addDataRequest(drId, height, event.txHash, {
        replicationFactor: data.replicationFactor,
        execProgramId: data.execProgramId,
        tallyProgramId: data.tallyProgramId,
        execGasLimit: data.execGasLimit,
        tallyGasLimit: data.tallyGasLimit,
        gasPrice: data.gasPrice,
      });

      // Create data request object for the pool using event data (no RPC needed)
      const dataRequest = {
        id: drId,
        version: data.version,
        execProgramId: data.execProgramId,
        execInputs: data.execInputs,
        execGasLimit: data.execGasLimit,
        tallyProgramId: data.tallyProgramId,
        tallyInputs: data.tallyInputs,
        tallyGasLimit: data.tallyGasLimit,
        replicationFactor: data.replicationFactor,
        consensusFilter: data.consensusFilter,
        gasPrice: data.gasPrice,
        memo: data.memo,
        height: height,
        // Add missing required fields
        paybackAddress: Buffer.alloc(0),
        sedaPayload: Buffer.alloc(0),
        commitsLength: 0,
        lastUpdated: new Date(),
      };

      // Add to the shared DataRequestPool that DataRequestTask expects
      this.pool.insertDataRequest(dataRequest);
      logger.debug(`Added DR ${drId} to shared pool using event data`);

      // Check eligibility for all our identities in background - non-blocking
      setImmediate(async () => {
        try {
          const drDetails = {
            ...data,
            height: height,
          };
          const eligibilityResult = await this.eligibilityChecker.checkEligibilityForNewDR(
            drId,
            drDetails,
            height,
            this.identityPool
          );

          if (eligibilityResult.isOk && eligibilityResult.value.size > 0) {
            // We have eligible identities
            const eligibleIdentities = eligibilityResult.value;
            this.stateManager.setEligibility(drId, eligibleIdentities);
            
            const identityIds = Array.from(eligibleIdentities.keys());
            const eligibilityHeight = Array.from(eligibleIdentities.values())[0] || height; // Use first eligibility height or current height
            
            logger.info(`Found ${identityIds.length} eligible identities for DR ${drId}`);
            this.emit('eligible', drId, identityIds as string[], eligibilityHeight);
          } else {
            logger.debug(`No eligible identities for DR ${drId}`);
          }
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          logger.error(`Failed to check eligibility for DR ${drId}: ${err.message}`);
        }
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(`Failed to handle posted DR ${drId}: ${err.message}`);
    }
  }

  /**
   * Handle a commit received on the chain
   */
  private async handleDataRequestCommitted(event: DataRequestEvent, height: bigint): Promise<void> {
    const { drId, data } = event;
    
    logger.debug(`🔍 Processing commit event for DR ${drId}. Event type: ${typeof data}, structure: ${this.getDataStructureInfo(data)}`, {
      id: `${drId}_commit`,
    });

    // Extract commit details from the event data
    const commitData = this.extractCommitData(data);
    if (!commitData) {
      logger.warn(`❌ Failed to extract commit data for DR ${drId}. Trying diagnostic extraction...`);
      this.logDiagnosticInfo(data, 'commit', drId);
      return;
    }

    logger.info(`✅ Extracted commit data for DR ${drId}: executor=${commitData.executorAddress}`, {
      id: `${drId}_commit`,
    });

    // Use the state manager's addCommit method which will trigger checkReadyForReveal
    this.stateManager.addCommit(drId, commitData.executorAddress, height);
    
    logger.info(`📝 Commit processed for DR ${drId}: ${commitData.executorAddress}`, {
      id: `${drId}_commit`,
    });
  }

  /**
   * Handle a reveal received on the chain
   */
  private async handleDataRequestRevealed(event: DataRequestEvent, height: bigint): Promise<void> {
    const { drId, data } = event;
    
    logger.info(`🔍 DEBUGGING REVEAL: Processing reveal event for DR ${drId}. Event type: ${typeof data}, structure: ${this.getDataStructureInfo(data)}`, {
      id: `${drId}_reveal`,
    });

    // 🚨 ENHANCED DEBUG: Log the raw data
    logger.info(`🔍 DEBUGGING REVEAL: Raw reveal data for DR ${drId}: ${JSON.stringify(this.sanitizeDataForLogging(data), null, 2)}`, {
      id: `${drId}_reveal`,
    });

    // Extract reveal details from the event data
    const revealData = this.extractRevealData(data);
    if (!revealData) {
      logger.warn(`❌ Failed to extract reveal data for DR ${drId}. Trying diagnostic extraction...`);
      this.logDiagnosticInfo(data, 'reveal', drId);
      
      // 🚨 TEMPORARY: Don't return early - let's see what happens with manual extraction
      logger.warn(`🔍 DEBUGGING: Attempting manual reveal data extraction for DR ${drId}...`);
      
      // Try to manually extract what we can
      const manualExtraction = this.attemptManualRevealExtraction(data);
      if (manualExtraction) {
        logger.info(`✅ Manual extraction successful for DR ${drId}: executor=${manualExtraction.executorAddress}`, {
          id: `${drId}_reveal`,
        });
        // Use the manually extracted data
        const trackedRequest = this.stateManager.getTrackedRequest(drId);
        if (trackedRequest) {
          logger.info(`📊 DEBUGGING: DR ${drId} current state - commits: ${trackedRequest.successfulCommits.size}/${trackedRequest.replicationFactor}, reveals: ${trackedRequest.successfulReveals.size}/${trackedRequest.replicationFactor}`, {
            id: `${drId}_reveal`,
          });
          
          // Just record the reveal with whatever executor address we found
          this.stateManager.addReveal(drId, manualExtraction.executorAddress, height);
          
          // Log completion check
          if (trackedRequest.successfulReveals.size >= trackedRequest.replicationFactor) {
            logger.info(`🏁 DR ${drId} should now be complete with ${trackedRequest.successfulReveals.size} reveals!`, {
              id: `${drId}_complete`,
            });
          }
        }
      }
      return;
    }

    logger.info(`✅ Extracted reveal data for DR ${drId}: executor=${revealData.executorAddress}`, {
      id: `${drId}_reveal`,
    });

    // Record the reveal in state manager
    this.stateManager.addReveal(drId, revealData.executorAddress, height);

    // Check if this is our reveal - if so, mark our identity as revealed
    const trackedRequest = this.stateManager.getTrackedRequest(drId);
    if (trackedRequest) {
      logger.info(`📊 DEBUGGING: DR ${drId} state after reveal - commits: ${trackedRequest.successfulCommits.size}/${trackedRequest.replicationFactor}, reveals: ${trackedRequest.successfulReveals.size}/${trackedRequest.replicationFactor}`, {
        id: `${drId}_reveal`,
      });
      
      // 🚨 DEBUGGING: Log identity matching attempts
      logger.info(`🔍 DEBUGGING: Checking identity matches for DR ${drId}. Our committed identities: [${Array.from(trackedRequest.commitHashes.keys()).join(', ')}], Reveal executor: ${revealData.executorAddress}`, {
        id: `${drId}_reveal`,
      });
      
      // Process all committed identities in parallel instead of sequentially
      const identityMatchPromises = Array.from(trackedRequest.commitHashes.keys()).map(async (identityId) => {
        logger.debug(`🔍 DEBUGGING: Comparing identityId="${identityId}" with executorAddress="${revealData.executorAddress}"`, {
          id: `${drId}_reveal`,
        });
        
        if (identityId === revealData.executorAddress) {
          logger.info(`🎉 Our reveal confirmed on-chain for DR ${drId}: ${identityId}`, {
            id: `${drId}_reveal`,
          });
          this.stateManager.markRevealed(drId, identityId, height);
          
          // Directly terminate the individual task (no more polling needed)
          if (this.mainTask) {
            this.mainTask.terminateTask(drId, identityId);
          } else {
            // Fallback: emit event for legacy compatibility
            this.emit('revealConfirmed', drId, identityId);
          }
          return true; // Found matching identity
        }
        return false;
      });
      
      // Wait for all identity checks to complete in parallel
      const matches = await Promise.all(identityMatchPromises);
      const hasMatch = matches.some(match => match);
      
      if (hasMatch) {
        logger.debug(`✅ Processed reveal identity match for DR ${drId} in parallel`);
      } else {
        logger.warn(`⚠️ DEBUGGING: No identity matches found for DR ${drId}. This might be a reveal from another node.`);
      }

      // Check if DR is complete (enough reveals)
      if (trackedRequest.successfulReveals.size >= trackedRequest.replicationFactor) {
        logger.info(`🏁 DR ${drId} is complete with ${trackedRequest.successfulReveals.size} reveals`, {
          id: `${drId}_complete`,
        });

        // Clean up completed DR
        this.stateManager.removeTrackedRequest(drId);
        this.pool.deleteDataRequest(drId);
      }
    }
  }

  /**
   * 🚨 TEMPORARY DEBUG: Manual reveal extraction attempt
   */
  private attemptManualRevealExtraction(data: any): { executorAddress: string } | null {
    try {
      // Try different common field names for executor/public key
      const possibleFields = [
        'public_key', 'pubkey', 'executor', 'sender', 'signer',
        'publicKey', 'executorAddress', 'executor_address'
      ];
      
      for (const field of possibleFields) {
        if (data[field]) {
          logger.info(`🔍 MANUAL EXTRACTION: Found executor in field "${field}": ${data[field]}`);
          return { executorAddress: data[field] };
        }
      }
      
      // Try looking in nested objects
      if (typeof data === 'object') {
        for (const [key, value] of Object.entries(data)) {
          if (typeof value === 'object' && value) {
            for (const field of possibleFields) {
              if ((value as any)[field]) {
                logger.info(`🔍 MANUAL EXTRACTION: Found executor in nested field "${key}.${field}": ${(value as any)[field]}`);
                return { executorAddress: (value as any)[field] };
              }
            }
          }
        }
      }
      
      return null;
    } catch (error) {
      logger.error(`Error in manual reveal extraction: ${error}`);
      return null;
    }
  }

  /**
   * Handle block monitor errors
   */
  private handleBlockMonitorError(error: Error): void {
    logger.error(`Block monitor error: ${error.message}`);
    this.emit('error', error);
  }

  /**
   * Add execution result for a data request
   */
  addExecutionResult(drId: string, identityId: string, result: any): void {
    this.stateManager.addExecutionResult(drId, identityId, result);
  }

  /**
   * Add commit hash for a data request
   */
  addCommitHash(drId: string, identityId: string, commitHash: string): void {
    this.stateManager.addCommitHash(drId, identityId, commitHash);
  }

  /**
   * Add reveal transaction hash for tracking (similar to addCommitHash)
   */
  addRevealHash(drId: string, identityId: string, revealHash: string): void {
    this.stateManager.addRevealHash(drId, identityId, revealHash);
  }

  /**
   * Mark that we have revealed for a data request
   */
  markRevealed(drId: string, identityId: string): void {
    this.stateManager.markRevealed(drId, identityId, this.lastProcessedHeight);
  }

  /**
   * Get a tracked data request
   */
  getTrackedRequest(drId: string): TrackedDataRequest | undefined {
    return this.stateManager.getTrackedRequest(drId);
  }

  /**
   * Get all tracked requests by status
   */
  getRequestsByStatus(status: any): TrackedDataRequest[] {
    return this.stateManager.getRequestsByStatus(status);
  }

  /**
   * Get statistics about the block monitoring task
   */
  getStats(): {
    isRunning: boolean;
    lastProcessedHeight: bigint;
    blockMonitorHealthy: boolean;
    trackedRequests: {
      total: number;
      byStatus: Record<string, number>;
    };
  } {
    return {
      isRunning: this.isRunning,
      lastProcessedHeight: this.lastProcessedHeight,
      blockMonitorHealthy: this.blockMonitor.isHealthy(),
      trackedRequests: this.stateManager.getStats(),
    };
  }

  /**
   * Check if the task is healthy
   */
  isHealthy(): boolean {
    return this.isRunning && this.blockMonitor.isHealthy();
  }

  /**
   * Extract commit data from transaction event data with smart field mapping
   */
  private extractCommitData(data: any): { executorAddress: string; commitmentHash?: string; drId?: string } | null {
    try {
      // Smart extraction with multiple fallback strategies
      const result = this.smartExtractEventData(data, 'commit');
      
      if (!result.executorAddress) {
        logger.warn(`❌ Could not extract executor address from commit data. Available fields: ${Object.keys(data).join(', ')}`);
        return null;
      }

      logger.debug(`✅ Extracted commit data: executor=${result.executorAddress}, commitment=${result.commitmentHash?.slice(0, 16)}..., method=${result.method}`);

      return {
        executorAddress: result.executorAddress,
        commitmentHash: result.commitmentHash || undefined,
        drId: result.drId || undefined
      };
    } catch (error) {
      logger.error(`Error extracting commit data: ${error}`);
      return null;
    }
  }

  /**
   * Extract reveal data from transaction event data with smart field mapping
   */
  private extractRevealData(data: any): { executorAddress: string; revealData?: string; drId?: string } | null {
    try {
      // Smart extraction with multiple fallback strategies
      const result = this.smartExtractEventData(data, 'reveal');
      
      if (!result.executorAddress) {
        logger.warn(`❌ Could not extract executor address from reveal data. Available fields: ${Object.keys(data).join(', ')}`);
        return null;
      }

      logger.debug(`✅ Extracted reveal data: executor=${result.executorAddress}, method=${result.method}`);

      return {
        executorAddress: result.executorAddress,
        revealData: result.revealData || undefined,
        drId: result.drId || undefined
      };
    } catch (error) {
      logger.error(`Error extracting reveal data: ${error}`);
      return null;
    }
  }

  /**
   * Smart event data extraction with multiple fallback strategies - optimized for parallel processing
   */
  private smartExtractEventData(data: any, eventType: 'commit' | 'reveal'): {
    executorAddress: string | null;
    commitmentHash?: string | null;
    revealData?: string | null;
    drId?: string | null;
    method: string;
  } {
    // Strategy 1: EventProcessor format (processed event data)
    if (data && typeof data === 'object') {
      // Check for our standardized event format first
      if (data.publicKey || data.public_key) {
        return {
          executorAddress: data.publicKey || data.public_key,
          commitmentHash: data.commitmentHash || data.commitment_hash || data.commitment,
          revealData: data.revealData || data.reveal_data || data.reveal,
          drId: data.dataRequestId || data.data_request_id || data.dr_id,
          method: 'processed-event-format'
        };
      }

      // Strategy 2: Raw transaction message format
      if (data.executor || data.sender) {
        return {
          executorAddress: data.executor || data.sender,
          commitmentHash: data.commitment || data.commitment_hash,
          revealData: data.reveal || data.reveal_data,
          drId: data.dr_id || data.data_request_id,
          method: 'raw-message-format'
        };
      }

      // Strategy 3: Blockchain event attributes format
      if (Array.isArray(data.attributes)) {
        const executorAttr = data.attributes.find((attr: any) => 
          ['executor', 'public_key', 'publicKey', 'sender'].includes(attr.key)
        );
        const commitmentAttr = data.attributes.find((attr: any) => 
          ['commitment', 'commitment_hash', 'commitmentHash'].includes(attr.key)
        );
        const drIdAttr = data.attributes.find((attr: any) => 
          ['dr_id', 'data_request_id', 'dataRequestId'].includes(attr.key)
        );

        if (executorAttr) {
          return {
            executorAddress: executorAttr.value,
            commitmentHash: commitmentAttr?.value,
            drId: drIdAttr?.value,
            method: 'blockchain-attributes'
          };
        }
      }

      // Strategy 4: Nested data structures
      if (data.data && typeof data.data === 'object') {
        const nestedResult = this.smartExtractEventData(data.data, eventType);
        if (nestedResult.executorAddress) {
          nestedResult.method = `nested-${nestedResult.method}`;
          return nestedResult;
        }
      }

      // Strategy 5: Look for any field that might contain executor info - OPTIMIZED WITH PARALLEL PROCESSING
      const possibleExecutorFields = [
        'publicKey', 'public_key', 'executor', 'sender', 'from', 'address',
        'signer', 'identity', 'identityId', 'identity_id'
      ];
      
      // Use find() instead of sequential for loop for better performance
      const matchingField = possibleExecutorFields.find(field => 
        data[field] && typeof data[field] === 'string'
      );
      
      if (matchingField) {
        return {
          executorAddress: data[matchingField],
          commitmentHash: data.commitment || data.commitment_hash || data.commitmentHash,
          revealData: data.reveal || data.reveal_data || data.revealData,
          drId: data.dr_id || data.data_request_id || data.dataRequestId,
          method: `fallback-${matchingField}`
        };
      }
    }

    // Strategy 6: String format (direct executor address)
    if (typeof data === 'string' && data.length > 10) {
      return {
        executorAddress: data,
        method: 'direct-string'
      };
    }

    return {
      executorAddress: null,
      method: 'extraction-failed'
    };
  }

  /**
   * Sanitize data for safe logging (removes sensitive info, truncates large objects)
   */
  private sanitizeDataForLogging(data: any): any {
    if (!data) return data;
    
    if (typeof data === 'string') {
      return data.length > 100 ? `${data.slice(0, 100)}...` : data;
    }
    
    if (typeof data !== 'object') return data;
    
    const sanitized: any = {};
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string') {
        // Truncate long strings
        sanitized[key] = value.length > 50 ? `${value.slice(0, 50)}...` : value;
      } else if (typeof value === 'object' && value !== null) {
        // Show object structure but not full content
        sanitized[key] = Array.isArray(value) 
          ? `Array(${(value as any[]).length})` 
          : `Object(${Object.keys(value as object).join(', ')})`;
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  /**
   * Get readable information about data structure for debugging
   */
  private getDataStructureInfo(data: any): string {
    if (!data) return 'null/undefined';
    if (typeof data === 'string') return `string(${data.length})`;
    if (typeof data === 'number') return 'number';
    if (typeof data === 'boolean') return 'boolean';
    if (Array.isArray(data)) return `array[${data.length}]`;
    if (typeof data === 'object') {
      const keys = Object.keys(data);
      return `object{${keys.slice(0, 5).join(', ')}${keys.length > 5 ? '...' : ''}}`;
    }
    return typeof data;
  }

  /**
   * Log detailed diagnostic information when extraction fails - optimized for parallel processing
   */
  private logDiagnosticInfo(data: any, eventType: 'commit' | 'reveal', drId: string): void {
    logger.info(`🔬 DIAGNOSTIC: ${eventType} extraction failed for DR ${drId}`);
    
    if (!data) {
      logger.info(`🔬 Data is ${data} (null/undefined)`);
      return;
    }

    if (typeof data !== 'object') {
      logger.info(`🔬 Data is not an object: ${typeof data} = ${data}`);
      return;
    }

    const keys = Object.keys(data);
    logger.info(`🔬 Available keys: ${keys.join(', ')}`);
    
    // Use filter() for efficient parallel-style processing instead of sequential loops
    const executorCandidates = keys.filter(key => {
      const lowerKey = key.toLowerCase();
      return lowerKey.includes('public') ||
             lowerKey.includes('key') ||
             lowerKey.includes('executor') ||
             lowerKey.includes('sender') ||
             lowerKey.includes('address');
    });
    
    if (executorCandidates.length > 0) {
      const executorInfo = executorCandidates.map(k => `${k}=${data[k]}`).join(', ');
      logger.info(`🔬 Potential executor fields: ${executorInfo}`);
    }

    // Use filter() for efficient parallel-style processing
    const drIdCandidates = keys.filter(key => {
      const lowerKey = key.toLowerCase();
      return lowerKey.includes('dr') ||
             lowerKey.includes('request') ||
             lowerKey.includes('id');
    });
    
    if (drIdCandidates.length > 0) {
      const drIdInfo = drIdCandidates.map(k => `${k}=${data[k]}`).join(', ');
      logger.info(`🔬 Potential DR ID fields: ${drIdInfo}`);
    }

    // Use slice() and map() for efficient parallel-style processing of sample entries
    const sampleEntries = Object.entries(data).slice(0, 5);
    const sampleInfo = sampleEntries.map(([key, value]) => {
      const valueStr = typeof value === 'string' 
        ? (value.length > 50 ? `${value.slice(0, 50)}...` : value)
        : String(value);
      return `🔬 ${key}: ${valueStr}`;
    });
    
    // Log all sample info in batch
    sampleInfo.forEach(info => logger.info(info));
  }

  	/**
	 * 🚀 NEW: Record execution start for timing tracking
	 */
	recordExecutionStarted(drId: string, identityId: string): void {
		this.stateManager.recordExecutionStarted(drId, identityId);
	}

	/**
	 * 🚀 NEW: Get performance statistics for a specific DR
	 */
	getPerformanceStats(drId: string) {
		return this.stateManager.getPerformanceStats(drId);
	}

	/**
	 * 🚀 NEW: Get performance summary for all tracked DRs
	 */
	getPerformanceSummary() {
		return this.stateManager.getPerformanceSummary();
	}

	/**
	 * 🚀 NEW: Log current performance summary (useful for debugging)
	 */
	logPerformanceSummary(): void {
		const summary = this.getPerformanceSummary();
		if (summary.length === 0) {
			logger.info("📊 No DRs currently being tracked");
			return;
		}

		logger.info(`📊 PERFORMANCE SUMMARY (${summary.length} tracked DRs):`);
		for (const dr of summary) {
			const status = dr.isCompleted ? '✅' : '🔄';
			const totalTime = dr.totalTime ? `${(dr.totalTime / 1000).toFixed(1)}s` : 'ongoing';
			logger.info(`  ${status} ${dr.drId.slice(0, 16)}: ${dr.status} (${dr.identityCount} identities, ${totalTime})`);
		}
	}

	/**
	 * 🚨 DEBUGGING: Force performance summary logging (call this manually for debugging)
	 */
	debugShowCurrentState(): void {
		logger.info("🔍 DEBUGGING: Current block monitor state:");
		logger.info(`  - Running: ${this.isRunning}`);
		logger.info(`  - Last processed height: ${this.lastProcessedHeight}`);
		logger.info(`  - Block monitor healthy: ${this.blockMonitor.isHealthy()}`);
		
		this.logPerformanceSummary();
		
		// Show detailed stats for active DRs
		const activeRequests = this.stateManager.getRequestsByStatus('executing');
		const committedRequests = this.stateManager.getRequestsByStatus('committed');
		const revealingRequests = this.stateManager.getRequestsByStatus('revealing');
		
		logger.info(`🔍 DEBUGGING: Active DRs by status:`);
		logger.info(`  - Executing: ${activeRequests.length}`);
		logger.info(`  - Committed: ${committedRequests.length}`);
		logger.info(`  - Revealing: ${revealingRequests.length}`);
		
		// Show specific DR details
		const allStatuses = ['posted', 'executing', 'committed', 'revealing', 'revealed', 'completed'];
		for (const status of allStatuses) {
			const requests = this.stateManager.getRequestsByStatus(status as any);
			for (const req of requests) {
				logger.info(`  🔸 DR ${req.drId.slice(0, 16)}: ${status} (${req.successfulCommits.size}/${req.replicationFactor} commits, ${req.successfulReveals.size}/${req.replicationFactor} reveals)`);
			}
		}
	}
} 