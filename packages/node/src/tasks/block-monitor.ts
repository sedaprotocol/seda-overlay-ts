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

type EventMap = {
  eligible: [drId: string, identityIds: string[], eligibilityHeight: bigint];
  readyForReveal: [drId: string, identityIds: string[]];
  completed: [drId: string];
  error: [Error];
};

export class BlockMonitorTask extends EventEmitter<EventMap> {
  private blockMonitor: BlockMonitorService;
  private eventProcessor: EventProcessor;
  private stateManager: DataRequestStateManager;
  private eligibilityChecker: EligibilityChecker;
  private isRunning = false;
  private lastProcessedHeight: bigint = 0n;

  constructor(
    private config: AppConfig,
    private sedaChain: SedaChain,
    private identityPool: IdentityPool,
  ) {
    super();
    
    this.blockMonitor = new BlockMonitorService(config);
    this.eventProcessor = new EventProcessor();
    this.stateManager = new DataRequestStateManager();
    this.eligibilityChecker = new EligibilityChecker();
    
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
   * Handle new block from block monitor
   */
  private async handleNewBlock(blockEvent: BlockEvent): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      logger.debug(`Processing block ${blockEvent.height} with ${blockEvent.transactions.length} transactions`);
      
      // Process all transactions in the block to extract SEDA events
      const events = await this.eventProcessor.processBlockTransactions(blockEvent);
      
      // Handle each event type
      for (const event of events) {
        await this.handleDataRequestEvent(event, blockEvent.height);
      }
      
      // Perform cleanup of old requests
      this.stateManager.performCleanupAtHeight(blockEvent.height);
      
      this.lastProcessedHeight = blockEvent.height;
      
      if (events.length > 0) {
        logger.debug(`Processed ${events.length} SEDA events in block ${blockEvent.height}`);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(`Failed to process block ${blockEvent.height}: ${err.message}`);
      this.emit('error', err);
    }
  }

  /**
   * Handle a specific data request event
   */
  private async handleDataRequestEvent(event: DataRequestEvent, height: bigint): Promise<void> {
    switch (event.type) {
      case 'posted':
        await this.handleDataRequestPosted(event, height);
        break;
      case 'committed':
        await this.handleCommitReceived(event, height);
        break;
      case 'revealed':
        await this.handleRevealReceived(event, height);
        break;
      default:
        logger.warn(`Unknown event type: ${(event as any).type}`);
    }
  }

  /**
   * Handle a new data request posted to the chain
   */
  private async handleDataRequestPosted(event: DataRequestEvent, height: bigint): Promise<void> {
    const { drId, data } = event;
    
    try {
      // Add to state manager
      this.stateManager.addDataRequest(drId, height, event.txHash, {
        replicationFactor: data.replicationFactor,
        execProgramId: data.execProgramId,
        tallyProgramId: data.tallyProgramId,
        execGasLimit: data.execGasLimit,
        tallyGasLimit: data.tallyGasLimit,
        gasPrice: data.gasPrice,
      });

      // Check eligibility for all our identities
      const eligibilityResult = await this.eligibilityChecker.checkEligibilityForNewDR(
        drId,
        data,
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
      logger.error(`Failed to handle posted DR ${drId}: ${err.message}`);
    }
  }

  /**
   * Handle a commit received on the chain
   */
  private async handleCommitReceived(event: DataRequestEvent, height: bigint): Promise<void> {
    const { drId, data } = event;
    
    try {
      // Record the commit in state manager
      this.stateManager.addCommit(drId, data.publicKey, height);
      
      logger.debug(`Recorded commit for DR ${drId} by ${data.publicKey}`);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(`Failed to handle commit for DR ${drId}: ${err.message}`);
    }
  }

  /**
   * Handle a reveal received on the chain
   */
  private async handleRevealReceived(event: DataRequestEvent, height: bigint): Promise<void> {
    const { drId, data } = event;
    
    try {
      // Record the reveal in state manager
      this.stateManager.addReveal(drId, data.publicKey, height);
      
      logger.debug(`Recorded reveal for DR ${drId} by ${data.publicKey}`);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(`Failed to handle reveal for DR ${drId}: ${err.message}`);
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
} 