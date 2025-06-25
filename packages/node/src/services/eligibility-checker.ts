import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Result } from "true-myth";
import type { IdentityPool } from "../models/identitiest-pool";

export interface DataRequestDetails {
  replicationFactor: number;
  execProgramId: string;
  tallyProgramId: string;
  execGasLimit: bigint;
  tallyGasLimit: bigint;
  gasPrice: bigint;
}

export class EligibilityChecker {
  /**
   * Check eligibility for a new data request for all identities in the pool
   * Returns Map of identityId -> eligibilityHeight for eligible identities
   */
  async checkEligibilityForNewDR(
    drId: string,
    drDetails: DataRequestDetails,
    height: bigint,
    identityPool: IdentityPool
  ): Promise<Result<Map<string, bigint>, Error>> {
    try {
      const eligibleIdentities = new Map<string, bigint>();
      
      // Get all available identities
      const identities = Array.from(identityPool.all());
      
      for (const identity of identities) {
        const eligibilityResult = await this.calculateOfflineEligibility(
          drId,
          drDetails,
          height,
          identity.identityId
        );
        
        if (eligibilityResult.isOk && eligibilityResult.value.isEligible) {
          eligibleIdentities.set(identity.identityId, eligibilityResult.value.eligibilityHeight);
          logger.debug(`Identity ${identity.identityId} is eligible for DR ${drId} at height ${eligibilityResult.value.eligibilityHeight}`);
        }
      }
      
      return Result.ok(eligibleIdentities);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return Result.err(new Error(`Failed to check eligibility for DR ${drId}: ${err.message}`));
    }
  }

  /**
   * Calculate offline eligibility for a specific identity and data request
   * This is a simplified implementation - the actual eligibility algorithm
   * would need to match the SEDA protocol specification
   */
  private async calculateOfflineEligibility(
    drId: string,
    drDetails: DataRequestDetails,
    height: bigint,
    publicKey: string
  ): Promise<Result<{ isEligible: boolean; eligibilityHeight: bigint }, Error>> {
    try {
      // TODO: Implement actual SEDA eligibility algorithm
      // This is a placeholder implementation
      
      // For now, use a simple hash-based eligibility check
      const eligibilityHash = this.computeEligibilityHash(drId, publicKey, height);
      const threshold = this.getEligibilityThreshold(drDetails.replicationFactor);
      
      const isEligible = eligibilityHash < threshold;
      const eligibilityHeight = height; // In real implementation, this might be different
      
      return Result.ok({
        isEligible,
        eligibilityHeight,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return Result.err(new Error(`Failed to calculate eligibility: ${err.message}`));
    }
  }

  /**
   * Compute eligibility hash for a DR and identity
   * This is a placeholder - actual implementation would use SEDA's VRF-based system
   */
  private computeEligibilityHash(drId: string, publicKey: string, height: bigint): number {
    // Simple hash function for demonstration
    // Real implementation would use VRF (Verifiable Random Function)
    const input = `${drId}-${publicKey}-${height}`;
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash) / 2147483647; // Normalize to 0-1 range
  }

  /**
   * Get eligibility threshold based on replication factor
   * Higher replication factor = higher threshold = more nodes eligible
   */
  private getEligibilityThreshold(replicationFactor: number): number {
    // Simple threshold calculation - real implementation would be more sophisticated
    // Base threshold that allows for some multiple of replication factor to be eligible
    const baseThreshold = 0.1; // 10% base chance
    const scalingFactor = Math.min(replicationFactor / 10, 1.0); // Scale up to 100% for high replication
    return Math.min(baseThreshold + (scalingFactor * 0.3), 0.8); // Cap at 80%
  }

  /**
   * Check if an identity is still eligible at current height
   * Used for validation before execution
   */
  async validateEligibility(
    drId: string,
    drDetails: DataRequestDetails,
    identityId: string,
    originalEligibilityHeight: bigint,
    currentHeight: bigint
  ): Promise<Result<boolean, Error>> {
    try {
      // Re-calculate eligibility at current height
      const eligibilityResult = await this.calculateOfflineEligibility(
        drId,
        drDetails,
        currentHeight,
        identityId
      );
      
      if (eligibilityResult.isErr) {
        return Result.err(eligibilityResult.error);
      }
      
      // Check if still eligible and height is reasonable
      const isStillEligible = eligibilityResult.value.isEligible;
      const heightDiff = currentHeight - originalEligibilityHeight;
      const isHeightValid = heightDiff >= 0 && heightDiff < 100n; // Allow up to 100 blocks difference
      
      return Result.ok(isStillEligible && isHeightValid);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return Result.err(new Error(`Failed to validate eligibility: ${err.message}`));
    }
  }
} 