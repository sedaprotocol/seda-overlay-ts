import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Maybe } from "true-myth";

export interface TrackedDataRequest {
  drId: string;
  height: bigint;
  replicationFactor: number;
  successfulCommits: Set<string>; // public keys
  successfulReveals: Set<string>; // public keys
  isEligible: boolean;
  eligibilityHeight?: bigint;
  executionResult?: any; // Execution result from worker
  commitHash?: Buffer;
  status: 'posted' | 'executing' | 'committed' | 'revealing' | 'revealed' | 'completed';
  createdAt: number; // timestamp for cleanup
  drData: any; // Original DR data from post_data_request transaction arguments
}

export class DataRequestStateManager {
  private trackedRequests: Map<string, TrackedDataRequest> = new Map();
  private cleanupInterval: Maybe<Timer> = Maybe.nothing();
  private maxAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

  constructor(maxAge?: number) {
    if (maxAge) {
      this.maxAge = maxAge;
    }
    
    // Start cleanup timer
    this.cleanupInterval = Maybe.just(
      setInterval(() => {
        this.performCleanup();
      }, 60 * 1000) // Run cleanup every minute
    );
  }

  /**
   * Add a new data request from post_data_request transaction arguments
   */
  addDataRequest(drId: string, height: bigint, drData: any): void {
    if (this.trackedRequests.has(drId)) {
      logger.warn("Data request already being tracked");
      return;
    }

    const trackedRequest: TrackedDataRequest = {
      drId,
      height,
      replicationFactor: drData.replication_factor || 1,
      successfulCommits: new Set(),
      successfulReveals: new Set(),
      isEligible: false,
      status: 'posted',
      createdAt: Date.now(),
      drData
    };

    this.trackedRequests.set(drId, trackedRequest);
    logger.debug("Added new data request to state manager");
  }

  /**
   * Add a commit for a data request from commit_data_result transaction arguments
   */
  addCommit(drId: string, publicKey: string): void {
    const request = this.trackedRequests.get(drId);
    if (!request) {
      logger.warn("Attempted to add commit for unknown data request");
      return;
    }

    request.successfulCommits.add(publicKey);
    
    // Update status if this is the first commit
    if (request.status === 'posted' || request.status === 'executing') {
      request.status = 'committed';
    }

    logger.debug("Added commit to data request state");
  }

  /**
   * Add a reveal for a data request from reveal_data_result transaction arguments
   */
  addReveal(drId: string, publicKey: string): void {
    const request = this.trackedRequests.get(drId);
    if (!request) {
      logger.warn("Attempted to add reveal for unknown data request");
      return;
    }

    request.successfulReveals.add(publicKey);
    
    // Update status
    if (request.status === 'committed') {
      request.status = 'revealing';
    }
    
    // Check if we have enough reveals to complete
    if (request.successfulReveals.size >= request.replicationFactor) {
      request.status = 'completed';
      logger.debug("Data request completed - all reveals received");
    }

    logger.debug("Added reveal to data request state");
  }

  /**
   * Check if a data request is ready for reveal
   */
  isReadyForReveal(drId: string): boolean {
    const request = this.trackedRequests.get(drId);
    if (!request) {
      return false;
    }

    // Ready for reveal if we have enough commits
    return request.successfulCommits.size >= request.replicationFactor;
  }

  /**
   * Check if a data request should be cleaned up
   */
  shouldCleanup(drId: string): boolean {
    const request = this.trackedRequests.get(drId);
    if (!request) {
      return true; // Clean up non-existent requests
    }

    // Clean up completed requests or very old requests
    return request.status === 'completed' || 
           (Date.now() - request.createdAt) > this.maxAge;
  }

  /**
   * Get a tracked data request
   */
  getTrackedRequest(drId: string): TrackedDataRequest | undefined {
    return this.trackedRequests.get(drId);
  }

  /**
   * Update eligibility status for a data request
   */
  updateEligibility(drId: string, isEligible: boolean, eligibilityHeight?: bigint): void {
    const request = this.trackedRequests.get(drId);
    if (!request) {
      logger.warn("Attempted to update eligibility for unknown data request");
      return;
    }

    request.isEligible = isEligible;
    if (eligibilityHeight) {
      request.eligibilityHeight = eligibilityHeight;
    }

    // Update status if eligible and not yet executing
    if (isEligible && request.status === 'posted') {
      request.status = 'executing';
    }

    logger.debug("Updated data request eligibility");
  }

  /**
   * Update execution result for a data request
   */
  updateExecutionResult(drId: string, result: any, commitHash?: Buffer): void {
    const request = this.trackedRequests.get(drId);
    if (!request) {
      logger.warn("Attempted to update execution result for unknown data request");
      return;
    }

    request.executionResult = result;
    if (commitHash) {
      request.commitHash = commitHash;
    }

    logger.debug("Updated data request execution result");
  }

  /**
   * Get all data requests in a specific status
   */
  getRequestsByStatus(status: TrackedDataRequest['status']): TrackedDataRequest[] {
    return Array.from(this.trackedRequests.values())
      .filter(request => request.status === status);
  }

  /**
   * Get all eligible data requests that haven't been executed yet
   */
  getEligibleRequests(): TrackedDataRequest[] {
    return Array.from(this.trackedRequests.values())
      .filter(request => request.isEligible && request.status === 'posted');
  }

  /**
   * Get requests ready for reveal
   */
  getRequestsReadyForReveal(): TrackedDataRequest[] {
    return Array.from(this.trackedRequests.values())
      .filter(request => this.isReadyForReveal(request.drId) && request.status === 'committed');
  }

  /**
   * Remove a data request from tracking
   */
  removeRequest(drId: string): void {
    if (this.trackedRequests.delete(drId)) {
      logger.debug("Removed data request from state manager");
    }
  }

  /**
   * Perform cleanup of old/completed requests
   */
  private performCleanup(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [drId, request] of this.trackedRequests.entries()) {
      if (this.shouldCleanup(drId)) {
        this.trackedRequests.delete(drId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.debug("Cleaned up old data requests");
    }
  }

  /**
   * Get statistics about tracked requests
   */
  getStats(): {
    total: number;
    posted: number;
    executing: number;
    committed: number;
    revealing: number;
    revealed: number;
    completed: number;
  } {
    const stats = {
      total: this.trackedRequests.size,
      posted: 0,
      executing: 0,
      committed: 0,
      revealing: 0,
      revealed: 0,
      completed: 0
    };

    for (const request of this.trackedRequests.values()) {
      switch (request.status) {
        case 'posted':
          stats.posted++;
          break;
        case 'executing':
          stats.executing++;
          break;
        case 'committed':
          stats.committed++;
          break;
        case 'revealing':
          stats.revealing++;
          break;
        case 'revealed':
          stats.revealed++;
          break;
        case 'completed':
          stats.completed++;
          break;
      }
    }

    return stats;
  }

  /**
   * Cleanup on shutdown
   */
  destroy(): void {
    this.cleanupInterval.match({
      Just: (timer) => clearInterval(timer),
      Nothing: () => {}
    });
    this.trackedRequests.clear();
  }
} 