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
  
  // 🚀 NEW: Performance monitoring timestamps
  timestamps: {
    detected: Date; // When DR was first detected
    eligibilityChecked?: Date; // When eligibility was determined
    firstExecution?: Date; // When first identity started execution
    firstCommit?: Date; // When first commit was submitted
    allCommitsReceived?: Date; // When replication factor was met
    firstReveal?: Date; // When first reveal was submitted
    completed?: Date; // When DR was fully completed
  };
  
  // 🚀 NEW: Performance metrics by identity
  identityMetrics: Map<string, {
    executionStarted?: Date;
    executionCompleted?: Date;
    commitSubmitted?: Date;
    commitConfirmed?: Date;
    revealSubmitted?: Date;
    revealConfirmed?: Date;
  }>;
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
      timestamps: {
        detected: new Date(),
      },
      identityMetrics: new Map(),
    };

    this.trackedRequests.set(drId, trackedRequest);
    logger.debug(`Added data request ${drId} for tracking`);
  }

  /**
   * Set eligibility results for a data request
   */
  setEligibility(drId: string, eligibleIdentities: Map<string, bigint>): void {
    const request = this.trackedRequests.get(drId);
    if (!request) {
      logger.warn(`Cannot set eligibility for unknown DR ${drId}`);
      return;
    }

    request.isEligible = eligibleIdentities.size > 0;
    request.eligibleIdentities = eligibleIdentities;
    
    // 🚀 TIMING: Record eligibility check completion
    request.timestamps.eligibilityChecked = new Date();
    
    // Initialize identity metrics for eligible identities
    for (const identityId of eligibleIdentities.keys()) {
      if (!request.identityMetrics.has(identityId)) {
        request.identityMetrics.set(identityId, {});
      }
    }
    
    const totalEligible = eligibleIdentities.size;
    logger.info(`✅ Eligibility determined for DR ${drId}: ${totalEligible} eligible identities`);
    
    if (request.isEligible) {
      this.updateStatus(request, 'executing');
    }
  }

  /**
   * Record execution started for an identity
   */
  recordExecutionStarted(drId: string, identityId: string): void {
    const request = this.trackedRequests.get(drId);
    if (!request) return;

    const identityMetrics = request.identityMetrics.get(identityId);
    if (identityMetrics) {
      identityMetrics.executionStarted = new Date();
      
      // Record first execution globally
      if (!request.timestamps.firstExecution) {
        request.timestamps.firstExecution = new Date();
        logger.info(`🏃 First execution started for DR ${drId} by identity ${identityId}`);
      }
    }
  }

  /**
   * Add execution result for a data request identity
   */
  addExecutionResult(drId: string, identityId: string, result: ExecutionResult): void {
    const request = this.trackedRequests.get(drId);
    if (!request) {
      logger.warn(`Cannot add execution result for unknown DR ${drId}`);
      return;
    }

    request.executionResults.set(identityId, result);
    
    // 🚀 TIMING: Record execution completion
    const identityMetrics = request.identityMetrics.get(identityId);
    if (identityMetrics) {
      identityMetrics.executionCompleted = new Date();
      
      // Calculate execution time
      if (identityMetrics.executionStarted) {
        const executionTime = identityMetrics.executionCompleted.getTime() - identityMetrics.executionStarted.getTime();
        logger.info(`⚡ Execution completed for DR ${drId}, identity ${identityId}: ${executionTime}ms`);
      }
    }

    logger.debug(`Added execution result for DR ${drId}, identity ${identityId}`);
  }

  /**
   * Add commit hash for a data request identity
   */
  addCommitHash(drId: string, identityId: string, commitHash: string): void {
    const request = this.trackedRequests.get(drId);
    if (!request) {
      logger.warn(`Cannot add commit hash for unknown DR ${drId}`);
      return;
    }

    request.commitHashes.set(identityId, commitHash);
    
    // 🚀 TIMING: Record commit submission
    const identityMetrics = request.identityMetrics.get(identityId);
    if (identityMetrics) {
      identityMetrics.commitSubmitted = new Date();
      
      // Record first commit globally
      if (!request.timestamps.firstCommit) {
        request.timestamps.firstCommit = new Date();
        logger.info(`📝 First commit submitted for DR ${drId} by identity ${identityId}`);
      }
      
      // Calculate time from execution to commit
      if (identityMetrics.executionCompleted) {
        const commitTime = identityMetrics.commitSubmitted.getTime() - identityMetrics.executionCompleted.getTime();
        logger.info(`📨 Commit submitted for DR ${drId}, identity ${identityId}: ${commitTime}ms after execution`);
      }
    }

    // 🔥 CRITICAL: Transition status from executing to committed when we submit our commit
    if (request.status === 'executing') {
      this.updateStatus(request, 'committed');
      
      // Now that we're committed, check if we should reveal
      // (replication factor might have been met while we were executing)
      this.checkReadyForReveal(request);
    }

    logger.debug(`Added commit hash for DR ${drId}, identity ${identityId}: ${commitHash.slice(0, 16)}...`);
  }

  /**
   * Add reveal transaction hash for tracking
   */
  addRevealHash(drId: string, identityId: string, revealHash: string): void {
    const request = this.trackedRequests.get(drId);
    if (!request) {
      logger.warn(`Cannot add reveal hash for unknown DR ${drId}`);
      return;
    }
    
    // 🚀 TIMING: Record reveal submission
    const identityMetrics = request.identityMetrics.get(identityId);
    if (identityMetrics) {
      identityMetrics.revealSubmitted = new Date();
      
      // Record first reveal globally
      if (!request.timestamps.firstReveal) {
        request.timestamps.firstReveal = new Date();
        logger.info(`🎯 First reveal submitted for DR ${drId} by identity ${identityId}`);
      }
      
      // Calculate time from commit to reveal
      if (identityMetrics.commitSubmitted) {
        const revealTime = identityMetrics.revealSubmitted.getTime() - identityMetrics.commitSubmitted.getTime();
        logger.info(`🚀 Reveal submitted for DR ${drId}, identity ${identityId}: ${revealTime}ms after commit`);
      }
    }

    logger.debug(`Added reveal hash for DR ${drId}, identity ${identityId}: ${revealHash.slice(0, 16)}...`);
  }

  /**
   * Record a successful commit from any node (observed on chain)
   */
  addCommit(drId: string, publicKey: string, height: bigint): void {
    const request = this.trackedRequests.get(drId);
    if (!request) {
      logger.debug(`Observed commit for untracked DR ${drId}`);
      return;
    }

    request.successfulCommits.add(publicKey);
    request.lastUpdated = height;

    // 🚀 TIMING: Track commit confirmations for our identities
    for (const [identityId, metrics] of request.identityMetrics) {
      if (identityId === publicKey && metrics.commitSubmitted && !metrics.commitConfirmed) {
        metrics.commitConfirmed = new Date();
        const confirmationTime = metrics.commitConfirmed.getTime() - metrics.commitSubmitted.getTime();
        logger.info(`✅ Commit confirmed on-chain for DR ${drId}, identity ${identityId}: ${confirmationTime}ms after submission`);
      }
    }

    logger.info(`📊 DR ${drId} commit stats: ${request.successfulCommits.size}/${request.replicationFactor} commits received (replication factor: ${request.replicationFactor})`);
    logger.debug(`Recorded commit for DR ${drId} by ${publicKey}. Total commits: ${request.successfulCommits.size}/${request.replicationFactor}`);

    // Check if we should transition to revealing state
    if (request.successfulCommits.size >= request.replicationFactor) {
      // 🚀 TIMING: Record when all commits are received
      if (!request.timestamps.allCommitsReceived) {
        request.timestamps.allCommitsReceived = new Date();
        
        // Calculate time from first commit to all commits received
        if (request.timestamps.firstCommit) {
          const totalCommitTime = request.timestamps.allCommitsReceived.getTime() - request.timestamps.firstCommit.getTime();
          logger.info(`🎯 All commits received for DR ${drId}: ${totalCommitTime}ms from first commit`);
        }
      }
      
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

    logger.info(`🔍 DEBUGGING ADDREVEAL: Processing reveal for DR ${drId} by ${publicKey} - current: ${request.successfulReveals.size}/${request.replicationFactor}`);

    request.successfulReveals.add(publicKey);
    request.lastUpdated = height;

    // 🚀 TIMING: Track reveal confirmations for our identities
    for (const [identityId, metrics] of request.identityMetrics) {
      if (identityId === publicKey && metrics.revealSubmitted && !metrics.revealConfirmed) {
        metrics.revealConfirmed = new Date();
        const confirmationTime = metrics.revealConfirmed.getTime() - metrics.revealSubmitted.getTime();
        logger.info(`✅ Reveal confirmed on-chain for DR ${drId}, identity ${identityId}: ${confirmationTime}ms after submission`);
      }
    }

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

    // 🚨 DEBUGGING: Enhanced completion check logging
    logger.info(`🔍 DEBUGGING COMPLETION CHECK: DR ${drId} - reveals: ${request.successfulReveals.size}/${request.replicationFactor}, status: ${request.status}`);

    // Check if DR is completed
    if (request.successfulReveals.size >= request.replicationFactor) {
      logger.info(`🎉 DEBUGGING: DR ${drId} SHOULD BE COMPLETING NOW! Reveals: ${request.successfulReveals.size}/${request.replicationFactor}`);
      
      // 🚀 TIMING: Record completion and log comprehensive performance metrics
      request.timestamps.completed = new Date();
      
      logger.info(`📊 DEBUGGING: About to log performance metrics for completed DR ${drId}`);
      
      this.logPerformanceMetrics(request);
      this.updateStatus(request, 'completed');
      
      logger.info(`✅ DEBUGGING: DR ${drId} marked as completed successfully!`);
    } else {
      logger.info(`⏳ DEBUGGING: DR ${drId} not yet complete - need ${request.replicationFactor - request.successfulReveals.size} more reveals`);
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
    
    // 🚀 TIMING: Record reveal confirmation for our identity
    const identityMetrics = request.identityMetrics.get(identityId);
    if (identityMetrics && !identityMetrics.revealConfirmed) {
      identityMetrics.revealConfirmed = new Date();
      
      if (identityMetrics.revealSubmitted) {
        const confirmationTime = identityMetrics.revealConfirmed.getTime() - identityMetrics.revealSubmitted.getTime();
        logger.info(`✅ Our reveal confirmed for DR ${drId}, identity ${identityId}: ${confirmationTime}ms after submission`);
      }
    }
    
    if (request.status === 'revealing') {
      this.updateStatus(request, 'revealed');
    }

    logger.debug(`Marked DR ${drId} as revealed by identity ${identityId}`);
  }

  /**
   * Check if we're ready to reveal (replication factor met)
   */
  private checkReadyForReveal(request: TrackedDataRequest): void {
    logger.debug(`🔍 Checking reveal readiness for DR ${request.drId}: status=${request.status}, commits=${request.successfulCommits.size}/${request.replicationFactor}, ourCommits=${request.commitHashes.size}`);
    
    if (request.status !== 'committed') {
      logger.debug(`DR ${request.drId} not ready for reveal check: status is ${request.status}, expected 'committed'`);
      return; // Not in the right state
    }

    // Check if replication factor has been met by all nodes
    if (request.successfulCommits.size < request.replicationFactor) {
      logger.info(`🔄 DR ${request.drId} waiting for more commits: ${request.successfulCommits.size}/${request.replicationFactor} received`);
      return;
    }

    // Check if we have committed identities that should reveal
    const identitiesReadyToReveal = Array.from(request.commitHashes.keys());
    
    if (identitiesReadyToReveal.length > 0) {
      logger.info(`🎯 DR ${request.drId} READY FOR REVEAL: ${request.successfulCommits.size}/${request.replicationFactor} total commits, ${identitiesReadyToReveal.length} our identities ready`);
      this.updateStatus(request, 'revealing');
      logger.info(`🚀 Emitting readyForReveal event for DR ${request.drId} with identities: ${identitiesReadyToReveal.join(', ')}`);
      this.emit('readyForReveal', request.drId, identitiesReadyToReveal);
    } else {
      logger.warn(`DR ${request.drId} replication factor met but we have no committed identities to reveal`);
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
   * Get a tracked request by ID
   */
  getTrackedRequest(drId: string): TrackedDataRequest | undefined {
    return this.trackedRequests.get(drId);
  }

  /**
   * Remove a tracked request (for cleanup)
   */
  removeTrackedRequest(drId: string): boolean {
    const removed = this.trackedRequests.delete(drId);
    if (removed) {
      logger.debug(`Removed tracked request ${drId}`);
    }
    return removed;
  }

  /**
   * Get all requests with a specific status - optimized with parallel processing
   */
  getRequestsByStatus(status: DataRequestStatus): TrackedDataRequest[] {
    // Use Array.from with filter for efficient parallel-style processing
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
    logger.debug(`📊 Tracked requests: ${this.trackedRequests.size}`, this.getDetailedStats());
  }

  /**
   * Cleanup with current block height
   */
  performCleanupAtHeight(currentHeight: bigint): void {
    // Process all cleanup decisions in parallel instead of sequentially
    const cleanupPromises = Array.from(this.trackedRequests.keys()).map(async (drId) => {
      if (this.shouldCleanup(drId, currentHeight)) {
        return drId;
      }
      return null;
    });

    // Wait for all cleanup decisions to complete in parallel
    Promise.all(cleanupPromises).then((results) => {
      // Filter out null results and cleanup in parallel
      const toCleanup = results.filter((drId): drId is string => drId !== null);
      
      if (toCleanup.length > 0) {
        // Perform all cleanup operations in parallel
        const cleanupOperationPromises = toCleanup.map(async (drId) => {
          return Promise.resolve(this.cleanup(drId));
        });
        
        // Wait for all cleanup operations to complete
        Promise.all(cleanupOperationPromises).then(() => {
          logger.debug(`Cleaned up ${toCleanup.length} old data requests in parallel`);
        }).catch((error) => {
          logger.error(`Error during parallel cleanup: ${error}`);
        });
      }
    }).catch((error) => {
      logger.error(`Error during parallel cleanup decision processing: ${error}`);
    });
  }

  /**
   * Get detailed stats for debugging - parallel processing
   */
  private getDetailedStats(): any {
    // Process all stats collection in parallel instead of sequentially
    const statsPromises = Array.from(this.trackedRequests.entries()).map(async ([drId, request]) => {
      return {
        drId,
        stats: {
          status: request.status,
          commits: `${request.successfulCommits.size}/${request.replicationFactor}`,
          reveals: `${request.successfulReveals.size}/${request.replicationFactor}`,
          ourCommits: request.commitHashes.size,
          height: request.height.toString()
        }
      };
    });

    // Since this needs to return synchronously for logging, we'll use a different approach
    // Create stats object efficiently using Object.fromEntries
    const stats = Object.fromEntries(
      Array.from(this.trackedRequests.entries()).map(([drId, request]) => [
        drId,
        {
          status: request.status,
          commits: `${request.successfulCommits.size}/${request.replicationFactor}`,
          reveals: `${request.successfulReveals.size}/${request.replicationFactor}`,
          ourCommits: request.commitHashes.size,
          height: request.height.toString()
        }
      ])
    );
    
    return stats;
  }

  /**
   * Get statistics about tracked requests - optimized for parallel processing
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

    // Process all requests efficiently using Array.from for optimal performance
    const requests = Array.from(this.trackedRequests.values());
    
    // Count statuses in a single pass
    for (const request of requests) {
      byStatus[request.status]++;
    }

    return {
      total: requests.length,
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

  /**
   * 🚀 NEW: Log comprehensive performance metrics for a completed DR
   */
  private logPerformanceMetrics(request: TrackedDataRequest): void {
    const now = new Date();
    const startTime = request.timestamps.detected;
    
    // Calculate overall time
    const totalTime = now.getTime() - startTime.getTime();
    
    logger.info(`🏁 DR COMPLETED: ${request.drId}`);
    logger.info(`⏱️  TOTAL TIME: ${totalTime}ms (${(totalTime / 1000).toFixed(1)}s)`);
    
    // Log phase timings
    if (request.timestamps.eligibilityChecked) {
      const eligibilityTime = request.timestamps.eligibilityChecked.getTime() - startTime.getTime();
      logger.info(`📋 Eligibility check: ${eligibilityTime}ms`);
    }
    
    if (request.timestamps.firstExecution) {
      const timeToExecution = request.timestamps.firstExecution.getTime() - startTime.getTime();
      logger.info(`🏃 Time to first execution: ${timeToExecution}ms`);
    }
    
    if (request.timestamps.firstCommit) {
      const timeToCommit = request.timestamps.firstCommit.getTime() - startTime.getTime();
      logger.info(`📝 Time to first commit: ${timeToCommit}ms`);
    }
    
    if (request.timestamps.allCommitsReceived) {
      const timeToAllCommits = request.timestamps.allCommitsReceived.getTime() - startTime.getTime();
      logger.info(`📊 Time to all commits received: ${timeToAllCommits}ms`);
    }
    
    if (request.timestamps.firstReveal) {
      const timeToReveal = request.timestamps.firstReveal.getTime() - startTime.getTime();
      logger.info(`🎯 Time to first reveal: ${timeToReveal}ms`);
    }
    
    // Log per-identity performance
    logger.info(`👥 IDENTITY PERFORMANCE (${request.identityMetrics.size} identities):`);
    for (const [identityId, metrics] of request.identityMetrics) {
      this.logIdentityPerformance(request.drId, identityId, metrics, startTime);
    }
    
    // Log network statistics
    logger.info(`🌐 NETWORK STATS: Replication Factor: ${request.replicationFactor}, Commits: ${request.successfulCommits.size}, Reveals: ${request.successfulReveals.size}`);
    
    logger.info(`✨ DR ${request.drId} processing complete - see performance breakdown above`);
  }

  /**
   * 🚀 NEW: Log performance metrics for individual identity
   */
  private logIdentityPerformance(drId: string, identityId: string, metrics: any, drStartTime: Date): void {
    const id = identityId.slice(0, 8);
    let performanceLog = `  🔸 ${id}:`;
    
    if (metrics.executionStarted && metrics.executionCompleted) {
      const execTime = metrics.executionCompleted.getTime() - metrics.executionStarted.getTime();
      performanceLog += ` exec(${execTime}ms)`;
    }
    
    if (metrics.commitSubmitted && metrics.commitConfirmed) {
      const commitTime = metrics.commitConfirmed.getTime() - metrics.commitSubmitted.getTime();
      performanceLog += ` commit(${commitTime}ms)`;
    }
    
    if (metrics.revealSubmitted && metrics.revealConfirmed) {
      const revealTime = metrics.revealConfirmed.getTime() - metrics.revealSubmitted.getTime();
      performanceLog += ` reveal(${revealTime}ms)`;
    }
    
    // Total time for this identity
    if (metrics.revealConfirmed) {
      const totalIdentityTime = metrics.revealConfirmed.getTime() - drStartTime.getTime();
      performanceLog += ` total(${totalIdentityTime}ms)`;
    }
    
    logger.info(performanceLog);
  }

  /**
   * 🚀 NEW: Get performance statistics for a DR (for monitoring/debugging)
   */
  getPerformanceStats(drId: string): {
    drId: string;
    status: DataRequestStatus;
    totalTime?: number;
    phases: {
      eligibilityTime?: number;
      timeToFirstExecution?: number;
      timeToFirstCommit?: number;
      timeToAllCommits?: number;
      timeToFirstReveal?: number;
      timeToCompletion?: number;
    };
    identityStats: Array<{
      identityId: string;
      executionTime?: number;
      commitTime?: number;
      revealTime?: number;
      totalTime?: number;
    }>;
  } | null {
    const request = this.trackedRequests.get(drId);
    if (!request) return null;

    const startTime = request.timestamps.detected;
    const endTime = request.timestamps.completed || new Date();
    
    // Calculate phase timings
    const phases = {
      eligibilityTime: request.timestamps.eligibilityChecked ? 
        request.timestamps.eligibilityChecked.getTime() - startTime.getTime() : undefined,
      timeToFirstExecution: request.timestamps.firstExecution ? 
        request.timestamps.firstExecution.getTime() - startTime.getTime() : undefined,
      timeToFirstCommit: request.timestamps.firstCommit ? 
        request.timestamps.firstCommit.getTime() - startTime.getTime() : undefined,
      timeToAllCommits: request.timestamps.allCommitsReceived ? 
        request.timestamps.allCommitsReceived.getTime() - startTime.getTime() : undefined,
      timeToFirstReveal: request.timestamps.firstReveal ? 
        request.timestamps.firstReveal.getTime() - startTime.getTime() : undefined,
      timeToCompletion: request.timestamps.completed ? 
        request.timestamps.completed.getTime() - startTime.getTime() : undefined,
    };

    // Calculate per-identity stats
    const identityStats = Array.from(request.identityMetrics.entries()).map(([identityId, metrics]) => {
      return {
        identityId: identityId.slice(0, 8), // Shortened for readability
        executionTime: metrics.executionStarted && metrics.executionCompleted ? 
          metrics.executionCompleted.getTime() - metrics.executionStarted.getTime() : undefined,
        commitTime: metrics.commitSubmitted && metrics.commitConfirmed ? 
          metrics.commitConfirmed.getTime() - metrics.commitSubmitted.getTime() : undefined,
        revealTime: metrics.revealSubmitted && metrics.revealConfirmed ? 
          metrics.revealConfirmed.getTime() - metrics.revealSubmitted.getTime() : undefined,
        totalTime: metrics.revealConfirmed ? 
          metrics.revealConfirmed.getTime() - startTime.getTime() : undefined,
      };
    });

    return {
      drId,
      status: request.status,
      totalTime: endTime.getTime() - startTime.getTime(),
      phases,
      identityStats,
    };
  }

  /**
   * 🚀 NEW: Get summary of all tracked DRs with their performance stats
   */
  getPerformanceSummary(): Array<{
    drId: string;
    status: DataRequestStatus;
    totalTime?: number;
    identityCount: number;
    isCompleted: boolean;
  }> {
    return Array.from(this.trackedRequests.entries()).map(([drId, request]) => {
      const startTime = request.timestamps.detected;
      const endTime = request.timestamps.completed || new Date();
      
      return {
        drId,
        status: request.status,
        totalTime: endTime.getTime() - startTime.getTime(),
        identityCount: request.identityMetrics.size,
        isCompleted: request.status === 'completed',
      };
    });
  }
} 