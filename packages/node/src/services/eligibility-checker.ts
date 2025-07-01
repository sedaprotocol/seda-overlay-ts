import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Result } from "true-myth";
import { type Context, type Span, type Tracer, trace } from "@opentelemetry/api";
import { type SedaChain, keccak256 } from "@sedaprotocol/overlay-ts-common";
import type { IdentityPool } from "../models/identitiest-pool";
import { getCurrentBlockHeight } from "./block";
import { getDrConfig, type DrConfig } from "./dr-config";
import { type Staker, getStakers } from "./get-staker";
import { getStakingConfig, type StakingConfig } from "./get-staking-config";

export interface DataRequestDetails {
  replicationFactor: number;
  execProgramId: string;
  tallyProgramId: string;
  execGasLimit: bigint;
  tallyGasLimit: bigint;
  gasPrice: bigint;
  height: bigint; // Add height to the interface
}

function computeSelectionHash(publicKey: Buffer, drId: string): Buffer {
  return keccak256(Buffer.concat([publicKey, Buffer.from(drId, "hex")]));
}

function calculateDrEligibility(
  activeStakers: Staker[],
  targetPublicKey: Buffer,
  minimumStake: bigint,
  backupDelayInBlocks: number,
  drId: string,
  replicationFactor: number,
  blocksPassed: bigint,
): boolean {
  const targetHash = computeSelectionHash(targetPublicKey, drId);

  // Count total eligible stakers and stakers with lower hash in one pass
  const { totalStakers, lowerHashCount } = activeStakers
    .filter((staker) => staker.tokensStaked >= minimumStake)
    .reduce(
      (acc, staker) => {
        const stakerHash = computeSelectionHash(staker.publicKey, drId);
        return {
          totalStakers: acc.totalStakers + 1,
          lowerHashCount: acc.lowerHashCount + (stakerHash.compare(targetHash) < 0 ? 1 : 0),
        };
      },
      { totalStakers: 0, lowerHashCount: 0 },
    );

  if (totalStakers === 0) {
    return false;
  }

  // Calculate total needed stakers, capped by total available
  const totalNeeded =
    Number(blocksPassed) > backupDelayInBlocks
      ? replicationFactor + Math.floor((Number(blocksPassed) - 1) / backupDelayInBlocks)
      : replicationFactor;

  const cappedTotalNeeded = Math.min(totalNeeded, totalStakers);

  // Staker is eligible if their position (by hash order) is within needed range
  const isEligible = lowerHashCount < cappedTotalNeeded;

  logger.debug(`Eligibility calculation: totalStakers=${totalStakers}, lowerHashCount=${lowerHashCount}, totalNeeded=${totalNeeded}, cappedTotalNeeded=${cappedTotalNeeded}, isEligible=${isEligible}`);

  return isEligible;
}

export class EligibilityChecker {
  private sedaChain: SedaChain;
  
  // Cache eligibility data to avoid repeated RPC calls
  private stakingConfigCache: {
    data: StakingConfig | null;
    height: bigint | null;
    expiry: number;
  } = {
    data: null,
    height: null,
    expiry: 0
  };
  
  private stakersCache: {
    data: Staker[] | null;
    height: bigint | null;
    expiry: number;
  } = {
    data: null,
    height: null,
    expiry: 0
  };
  
  private drConfigCache: {
    data: DrConfig | null;
    height: bigint | null;
    expiry: number;
  } = {
    data: null,
    height: null,
    expiry: 0
  };
  
  private currentHeightCache: {
    height: bigint | null;
    expiry: number;
  } = {
    height: null,
    expiry: 0
  };
  
  // Cache for 30 seconds to balance freshness with performance
  private readonly CACHE_TTL_MS = 30_000;

  constructor(sedaChain: SedaChain) {
    this.sedaChain = sedaChain;
  }

  /**
   * Get cached staking config or fetch if expired
   */
  private async getCachedStakingConfig(currentHeight: bigint): Promise<Result<StakingConfig, Error>> {
    const now = Date.now();
    if (
      this.stakingConfigCache.data && 
      this.stakingConfigCache.height === currentHeight &&
      this.stakingConfigCache.expiry > now
    ) {
      return Result.ok(this.stakingConfigCache.data);
    }
    
    const result = await getStakingConfig(this.sedaChain);
    if (result.isErr) {
      return result;
    }
    
    this.stakingConfigCache = {
      data: result.value,
      height: currentHeight,
      expiry: now + this.CACHE_TTL_MS
    };
    
    return result;
  }
  
  /**
   * Get cached stakers or fetch if expired
   */
  private async getCachedStakers(currentHeight: bigint): Promise<Result<Staker[], Error>> {
    const now = Date.now();
    if (
      this.stakersCache.data && 
      this.stakersCache.height === currentHeight &&
      this.stakersCache.expiry > now
    ) {
      return Result.ok(this.stakersCache.data);
    }
    
    const result = await getStakers(this.sedaChain);
    if (result.isErr) {
      return result;
    }
    
    this.stakersCache = {
      data: result.value,
      height: currentHeight,
      expiry: now + this.CACHE_TTL_MS
    };
    
    return result;
  }
  
  /**
   * Get cached DR config or fetch if expired
   */
  private async getCachedDrConfig(currentHeight: bigint): Promise<Result<DrConfig, Error>> {
    const now = Date.now();
    if (
      this.drConfigCache.data && 
      this.drConfigCache.height === currentHeight &&
      this.drConfigCache.expiry > now
    ) {
      return Result.ok(this.drConfigCache.data);
    }
    
    const result = await getDrConfig(this.sedaChain);
    if (result.isErr) {
      return result;
    }
    
    this.drConfigCache = {
      data: result.value,
      height: currentHeight,
      expiry: now + this.CACHE_TTL_MS
    };
    
    return result;
  }
  
  /**
   * Get cached current height or fetch if expired
   */
  private async getCachedCurrentHeight(): Promise<Result<bigint, Error>> {
    const now = Date.now();
    if (this.currentHeightCache.height && this.currentHeightCache.expiry > now) {
      return Result.ok(this.currentHeightCache.height);
    }
    
    const result = await getCurrentBlockHeight(this.sedaChain);
    if (result.isErr) {
      return result;
    }
    
    this.currentHeightCache = {
      height: result.value,
      expiry: now + 5000 // Cache height for only 5 seconds since it changes frequently
    };
    
    return result;
  }

  /**
   * Check eligibility for a new data request for all identities in the pool
   * Returns Map of identityId -> eligibilityHeight for eligible identities
   * Optimized with caching and parallel processing
   */
  async checkEligibilityForNewDR(
    drId: string,
    drDetails: DataRequestDetails,
    height: bigint,
    identityPool: IdentityPool
  ): Promise<Result<Map<string, bigint>, Error>> {
    try {
      logger.debug(`Starting eligibility check for DR ${drId} with ${Array.from(identityPool.all()).length} identities`);
      
      // Get current height first
      const currentHeightResult = await this.getCachedCurrentHeight();
      if (currentHeightResult.isErr) {
        return Result.err(new Error(`Failed to get current block height: ${currentHeightResult.error.message}`));
      }
      const currentHeight = currentHeightResult.value;
      
      // Fetch all required chain data in parallel with caching
      const [stakingConfigResult, stakersResult, drConfigResult] = await Promise.all([
        this.getCachedStakingConfig(currentHeight),
        this.getCachedStakers(currentHeight),
        this.getCachedDrConfig(currentHeight)
      ]);
      
      if (stakingConfigResult.isErr) {
        return Result.err(new Error(`Failed to get staking config: ${stakingConfigResult.error.message}`));
      }
      if (stakersResult.isErr) {
        return Result.err(new Error(`Failed to get stakers: ${stakersResult.error.message}`));
      }
      if (drConfigResult.isErr) {
        return Result.err(new Error(`Failed to get DR config: ${drConfigResult.error.message}`));
      }
      
      const stakingConfig = stakingConfigResult.value;
      const stakers = stakersResult.value;
      const drConfig = drConfigResult.value;
      
      // Calculate blocks passed once
      const blocksPassed = currentHeight - drDetails.height;
      
      // Get all available identities
      const identities = Array.from(identityPool.all());
      logger.debug(`Processing eligibility for ${identities.length} identities in parallel`);
      
      // Process all identities in parallel
      const eligibilityPromises = identities.map(async (identity) => {
        if (!identity.enabled) {
          return { identityId: identity.identityId, eligible: false, height: currentHeight };
        }

        try {
          const identityPublicKey = Buffer.from(identity.identityId, "hex");
          
          const isEligible = calculateDrEligibility(
            stakers,
            identityPublicKey,
            stakingConfig.minimumStake,
            drConfig.backupDelayInBlocks,
            drId,
            drDetails.replicationFactor,
            blocksPassed,
          );
          
          return { 
            identityId: identity.identityId, 
            eligible: isEligible, 
            height: currentHeight 
          };
        } catch (error) {
          logger.error(`Error checking eligibility for identity ${identity.identityId}: ${error}`);
          return { identityId: identity.identityId, eligible: false, height: currentHeight };
        }
      });
      
      // Wait for all eligibility checks to complete
      const eligibilityResults = await Promise.all(eligibilityPromises);
      
      // Collect eligible identities
      const eligibleIdentities = new Map<string, bigint>();
      let eligibleCount = 0;
      
      for (const result of eligibilityResults) {
        if (result.eligible) {
          eligibleIdentities.set(result.identityId, result.height);
          eligibleCount++;
          logger.debug(`🟢 Identity ${result.identityId} is eligible for DR ${drId}`);
        } else {
          logger.debug(`🔴 Identity ${result.identityId} is not eligible for DR ${drId}`);
        }
      }
      
      logger.info(`✅ Eligibility check complete: ${eligibleCount}/${identities.length} identities eligible for DR ${drId}`);
      return Result.ok(eligibleIdentities);
      
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(`Failed to check eligibility for DR ${drId}: ${err.message}`);
      return Result.err(new Error(`Failed to check eligibility for DR ${drId}: ${err.message}`));
    }
  }

  /**
   * Calculate real SEDA eligibility for a specific identity and data request
   * This uses the same algorithm as the legacy RPC system
   */
  private async calculateRealEligibility(
    drId: string,
    drDetails: DataRequestDetails,
    height: bigint,
    identityId: string
  ): Promise<Result<{ isEligible: boolean; eligibilityHeight: bigint }, Error>> {
    try {
      // Get required chain data for eligibility calculation
      const stakingConfigResult = await getStakingConfig(this.sedaChain);
      if (stakingConfigResult.isErr) {
        return Result.err(new Error(`Failed to get staking config: ${stakingConfigResult.error.message}`));
      }
      
      const currentBlockHeightResult = await getCurrentBlockHeight(this.sedaChain);
      if (currentBlockHeightResult.isErr) {
        return Result.err(new Error(`Failed to get current block height: ${currentBlockHeightResult.error.message}`));
      }
      
      const stakersResult = await getStakers(this.sedaChain);
      if (stakersResult.isErr) {
        return Result.err(new Error(`Failed to get stakers: ${stakersResult.error.message}`));
      }
      
      const drConfigResult = await getDrConfig(this.sedaChain);
      if (drConfigResult.isErr) {
        return Result.err(new Error(`Failed to get DR config: ${drConfigResult.error.message}`));
      }

      const blocksPassed = currentBlockHeightResult.value - drDetails.height;
      const identityPublicKey = Buffer.from(identityId, "hex");

      const isEligible = calculateDrEligibility(
        stakersResult.value,
        identityPublicKey,
        stakingConfigResult.value.minimumStake,
        drConfigResult.value.backupDelayInBlocks,
        drId,
        drDetails.replicationFactor,
        blocksPassed,
      );

      return Result.ok({
        isEligible,
        eligibilityHeight: currentBlockHeightResult.value,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return Result.err(new Error(`Failed to calculate eligibility: ${err.message}`));
    }
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
      const eligibilityResult = await this.calculateRealEligibility(
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
      const isHeightValid = heightDiff >= 0n && heightDiff < BigInt(100); // Allow up to 100 blocks difference
      
      return Result.ok(isStillEligible && isHeightValid);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return Result.err(new Error(`Failed to validate eligibility: ${err.message}`));
    }
  }
} 