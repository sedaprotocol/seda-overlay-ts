import { logger } from "@sedaprotocol/overlay-ts-logger";
import { EventEmitter } from "eventemitter3";
import type { ExecutionResult } from "./execution-result";

export type DataRequestStatus = 
  | 'posted'      // DR posted to chain, eligibility being calculated
  | 'executing'   // DR is being executed by this node
  | 'committed'   // Execution complete, commitment submitted
  | 'revealing'   // Waiting for replication factor to be met
  | 'revealed'    // This node has revealed its result
  | 'completed';  // DR fully resolved, ready for cleanup

export interface TrackedDataRequest {
  drId: string;
  height: bigint;
  txHash: string;
  
  // DR attributes from post_data_request
  replicationFactor: number;
  execProgramId: string;
  tallyProgramId: string;
  execGasLimit: bigint;
  tallyGasLimit: bigint;
  gasPrice: bigint;
  
  // Eligibility and execution state
  isEligible: boolean;
  eligibleIdentities: Map<string, bigint>; // identityId -> eligibilityHeight
  
  // Execution results by identity
  executionResults: Map<string, ExecutionResult>; // identityId -> result
  commitHashes: Map<string, string>; // identityId -> commitHash
  
  // Tracking commits and reveals from all nodes
  successfulCommits: Set<string>; // public keys that have committed
  successfulReveals: Set<string>; // public keys that have revealed
  
  // Current status
  status: DataRequestStatus;
  lastUpdated: bigint; // block height of last update
  
  // Cleanup tracking
  completedAt?: bigint; // block height when completed
}

type EventMap = {
  statusChanged: [drId: string, oldStatus: DataRequestStatus, newStatus: DataRequestStatus];
  readyForReveal: [drId: string, identityIds: string[]];
  completed: [drId: string];
  cleanup: [drId: string];
};

export class DataRequestStateManager extends EventEmitter<EventMap> {
  private trackedRequests: Map<string, TrackedDataRequest> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval>;
  private readonly CLEANUP_DELAY_BLOCKS = 100; // Clean up after 100 blocks

  constructor() {
    super();
    
    // Run cleanup every 30 seconds
    this.cleanupInterval = setInterval(() => {
      this.performCleanup();
    }, 30000);
  }

  /**
   * Add a new data request from a posted event
   */
  addDataRequest(
    drId: string,
    height: bigint,
    txHash: string,
    drData: {
      replicationFactor: number;
      execProgramId: string;
      tallyProgramId: string;
      execGasLimit: bigint;
      tallyGasLimit: bigint;
      gasPrice: bigint;
    }
  ): void {
    if (this.trackedRequests.has(drId)) {
      logger.warn(`Data request ${drId} already being tracked`);
      return;
    }

    const trackedRequest: TrackedDataRequest = {
      drId,
      height,
      txHash,
      replicationFactor: drData.replicationFactor,
      execProgramId: drData.execProgramId,
      tallyProgramId: drData.tallyProgramId,
      execGasLimit: drData.execGasLimit,
      tallyGasLimit: drData.tallyGasLimit,
      gasPrice: drData.gasPrice,
      isEligible: false,
      eligibleIdentities: new Map(),
      executionResults: new Map(),
      commitHashes: new Map(),
      successfulCommits: new Set(),
      successfulReveals: new Set(),
      status: 'posted',
      lastUpdated: height,
    };

    this.trackedRequests.set(drId, trackedRequest);
    logger.debug(`Added data request ${drId} for tracking`);
  }

  /**
   * Mark identities as eligible for a data request
   */
  setEligibility(drId: string, eligibleIdentities: Map<string, bigint>): void {
    const request = this.trackedRequests.get(drId);
    if (!request) {
      logger.warn(`Cannot set eligibility for unknown DR ${drId}`);
      return;
    }

    request.eligibleIdentities = eligibleIdentities;
    request.isEligible = eligibleIdentities.size > 0;
    
    if (request.isEligible && request.status === 'posted') {
      this.updateStatus(request, 'executing');
    }

    logger.debug(`Set eligibility for DR ${drId}: ${eligibleIdentities.size} eligible identities`);
  }

  /**
   * Add execution result for an identity
   */
  addExecutionResult(drId: string, identityId: string, result: ExecutionResult): void {
    const request = this.trackedRequests.get(drId);
    if (!request) {
      logger.warn(`Cannot add execution result for unknown DR ${drId}`);
      return;
    }

    request.executionResults.set(identityId, result);
    logger.debug(`Added execution result for DR ${drId}, identity ${identityId}`);
  }

  /**
   * Add commit hash for an identity
   */
  addCommitHash(drId: string, identityId: string, commitHash: string): void {
    const request = this.trackedRequests.get(drId);
    if (!request) {
      logger.warn(`Cannot add commit hash for unknown DR ${drId}`);
      return;
    }

    request.commitHashes.set(identityId, commitHash);
    
    if (request.status === 'executing') {
      this.updateStatus(request, 'committed');
    }

    logger.debug(`Added commit hash for DR ${drId}, identity ${identityId}`);
  }

  /**
   * Record a successful commit from any node (observed on chain)
   */
  addCommit(drId: string, publicKey: string, height: bigint): void {
    const request = this.trackedRequests.get(drId);
    if (!request) {
      // This might be a commit for a DR we're not tracking (not eligible)
      logger.debug(`Observed commit for untracked DR ${drId}`);
      return;
    }

    request.successfulCommits.add(publicKey);
    request.lastUpdated = height;

    logger.debug(`Recorded commit for DR ${drId} by ${publicKey}. Total commits: ${request.successfulCommits.size}/${request.replicationFactor}`);

    // Check if we should transition to revealing state
    if (request.successfulCommits.size >= request.replicationFactor) {
      this.checkReadyForReveal(request);
    }
  }

  /**
   * Record a successful reveal from any node (observed on chain)
   */
  addReveal(drId: string, publicKey: string, height: bigint): void {
    const request = this.trackedRequests.get(drId);
    if (!request) {
      logger.debug(`Observed reveal for untracked DR ${drId}`);
      return;
    }

    request.successfulReveals.add(publicKey);
    request.lastUpdated = height;

    logger.debug(`Recorded reveal for DR ${drId} by ${publicKey}. Total reveals: ${request.successfulReveals.size}/${request.replicationFactor}`);

    // Update our own status if we revealed
    const ourCommittedIdentities = Array.from(request.commitHashes.keys());
    const weRevealed = ourCommittedIdentities.some(identityId => {
      // Check if this reveal is from one of our identities (would need identity->publicKey mapping)
      // For now, assume we track this separately
      return false; // TODO: Implement identity->publicKey mapping
    });

    if (weRevealed && request.status === 'revealing') {
      this.updateStatus(request, 'revealed');
    }

    // Check if DR is completed
    if (request.successfulReveals.size >= request.replicationFactor) {
      this.updateStatus(request, 'completed');
    }
  }

  /**
   * Mark that we have revealed for this DR
   */
  markRevealed(drId: string, identityId: string, height: bigint): void {
    const request = this.trackedRequests.get(drId);
    if (!request) {
      logger.warn(`Cannot mark revealed for unknown DR ${drId}`);
      return;
    }

    request.lastUpdated = height;
    
    if (request.status === 'revealing') {
      this.updateStatus(request, 'revealed');
    }

    logger.debug(`Marked DR ${drId} as revealed by identity ${identityId}`);
  }

  /**
   * Check if we're ready to reveal (replication factor met)
   */
  private checkReadyForReveal(request: TrackedDataRequest): void {
    if (request.status !== 'committed') {
      return; // Not in the right state
    }

    // Check if we have committed identities that should reveal
    const identitiesReadyToReveal = Array.from(request.commitHashes.keys());
    
    if (identitiesReadyToReveal.length > 0) {
      this.updateStatus(request, 'revealing');
      this.emit('readyForReveal', request.drId, identitiesReadyToReveal);
    }
  }

  /**
   * Update the status of a data request
   */
  private updateStatus(request: TrackedDataRequest, newStatus: DataRequestStatus): void {
    const oldStatus = request.status;
    if (oldStatus === newStatus) {
      return; // No change
    }

    request.status = newStatus;
    
    logger.debug(`DR ${request.drId} status: ${oldStatus} → ${newStatus}`);
    this.emit('statusChanged', request.drId, oldStatus, newStatus);

    if (newStatus === 'completed') {
      request.completedAt = request.lastUpdated;
      this.emit('completed', request.drId);
    }
  }

  /**
   * Get a tracked data request
   */
  getTrackedRequest(drId: string): TrackedDataRequest | undefined {
    return this.trackedRequests.get(drId);
  }

  /**
   * Get all tracked requests in a specific status
   */
  getRequestsByStatus(status: DataRequestStatus): TrackedDataRequest[] {
    return Array.from(this.trackedRequests.values()).filter(req => req.status === status);
  }

  /**
   * Check if a data request should be cleaned up
   */
  shouldCleanup(drId: string, currentHeight: bigint): boolean {
    const request = this.trackedRequests.get(drId);
    if (!request) {
      return false;
    }

    // Clean up completed requests after delay
    if (request.status === 'completed' && request.completedAt) {
      return currentHeight - request.completedAt >= this.CLEANUP_DELAY_BLOCKS;
    }

    // Clean up very old requests that seem stuck
    const blocksSinceUpdate = currentHeight - request.lastUpdated;
    return blocksSinceUpdate >= this.CLEANUP_DELAY_BLOCKS * 2;
  }

  /**
   * Remove a data request from tracking
   */
  cleanup(drId: string): void {
    const request = this.trackedRequests.get(drId);
    if (request) {
      this.trackedRequests.delete(drId);
      this.emit('cleanup', drId);
      logger.debug(`Cleaned up tracking for DR ${drId}`);
    }
  }

  /**
   * Perform periodic cleanup of old requests
   */
  private performCleanup(): void {
    // We don't have current height here, so this would need to be called with height
    // For now, just log that cleanup would run
    logger.debug(`Tracked requests: ${this.trackedRequests.size}`);
  }

  /**
   * Cleanup with current block height
   */
  performCleanupAtHeight(currentHeight: bigint): void {
    const toCleanup: string[] = [];
    
    for (const [drId] of this.trackedRequests) {
      if (this.shouldCleanup(drId, currentHeight)) {
        toCleanup.push(drId);
      }
    }

    for (const drId of toCleanup) {
      this.cleanup(drId);
    }

    if (toCleanup.length > 0) {
      logger.debug(`Cleaned up ${toCleanup.length} old data requests`);
    }
  }

  /**
   * Get statistics about tracked requests
   */
  getStats(): {
    total: number;
    byStatus: Record<DataRequestStatus, number>;
  } {
    const byStatus: Record<DataRequestStatus, number> = {
      posted: 0,
      executing: 0,
      committed: 0,
      revealing: 0,
      revealed: 0,
      completed: 0,
    };

    for (const request of this.trackedRequests.values()) {
      byStatus[request.status]++;
    }

    return {
      total: this.trackedRequests.size,
      byStatus,
    };
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.trackedRequests.clear();
    this.removeAllListeners();
  }
} 