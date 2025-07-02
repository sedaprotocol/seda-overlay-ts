import { logger } from "@sedaprotocol/overlay-ts-logger";
import { EventEmitter } from "eventemitter3";
import { Maybe, Result } from "true-myth";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { Tendermint37Client } from "@cosmjs/tendermint-rpc";
import { TransactionParser } from "./transaction-parser";

export interface BlockEvent {
  height: bigint;
  block: any; // Block data from RPC query
  blockResults: any; // Block results from RPC query
  transactions: ParsedTransaction[];
}

export interface ParsedTransaction {
  hash: string;
  success: boolean;
  messages: ParsedMessage[];
  // NOTE: We do NOT use blockchain events - all data derived from message arguments
}

export interface ParsedMessage {
  typeUrl: string;
  value: any; // Decoded message arguments (this is where we extract all DR data)
  sedaContext?: SedaMessageContext;
}

export interface SedaMessageContext {
  type: 'post_data_request' | 'commit_data_result' | 'reveal_data_result';
  drId?: string;
  commitmentHash?: string;
  publicKey?: string;
}

interface FailedBlock {
  height: bigint;
  attempts: number;
  lastAttempt: Date;
  nextRetry: Date;
  error: string;
}

type EventMap = {
  newBlock: [BlockEvent];
  error: [Error];
};

export class BlockMonitorService extends EventEmitter<EventMap> {
  private tmClient: Maybe<Tendermint37Client> = Maybe.nothing();
  private transactionParser: TransactionParser;
  private isMonitoring = false;
  private lastProcessedHeight: bigint = 0n;
  private pollInterval: number;
  private intervalId?: ReturnType<typeof setInterval>;
  private instanceId: string;
  
  // 🚀 NEW: Failed block retry system
  private failedBlocks: Map<bigint, FailedBlock> = new Map();
  private retryIntervalId?: ReturnType<typeof setInterval>;
  private maxRetryAttempts: number;
  private retryBaseDelay: number;
  private processingBlocks: Set<bigint> = new Set(); // Track blocks currently being processed

  constructor(
    private appConfig: AppConfig,
    private config: {
      pollInterval?: number;
      maxBlockHistory?: number;
      connectionTimeout?: number;
      retryAttempts?: number;
      retryDelay?: number;
      tlsEnabled?: boolean;
    } = {}
  ) {
    super();
    this.pollInterval = config.pollInterval ?? 1000;
    this.maxRetryAttempts = config.retryAttempts ?? 10;
    this.retryBaseDelay = config.retryDelay ?? 2000; // Start with 2 second delay
    this.transactionParser = new TransactionParser();
    this.instanceId = Math.random().toString(36).substring(2, 8);
  }

  async startMonitoring(): Promise<Result<void, Error>> {
    try {
      logger.info(`Starting block monitoring with robust retry system [${this.instanceId}]`);

      // Create Tendermint client for block operations
      const rpcEndpoint = this.appConfig.sedaChain.rpc;
      logger.info(`Connecting to Tendermint RPC at ${rpcEndpoint} [${this.instanceId}]`);
      const tmClient = await Tendermint37Client.connect(rpcEndpoint);
      this.tmClient = Maybe.just(tmClient);
      
      // Get current height to start monitoring
      const latestHeight = await this.getCurrentHeight();
      if (latestHeight.isErr) {
        return Result.err(latestHeight.error);
      }

      this.lastProcessedHeight = latestHeight.value - 1n;
      this.isMonitoring = true;

      // Start polling for new blocks every second
      // 🚀 ISOLATION: Block polling never stops DR processes
      this.intervalId = setInterval(() => {
        this.pollForNewBlocks().catch((error) => {
          logger.debug(`[${this.instanceId}] Block polling error (continuing): ${error.message}`);
          // Don't emit error - this would stop monitoring. Continue running instead.
        });
      }, this.pollInterval);

      // 🚀 INDEPENDENT: Retry system runs independently without affecting main monitoring
      this.retryIntervalId = setInterval(() => {
        this.retryFailedBlocks().catch((error) => {
          logger.debug(`[${this.instanceId}] Retry system error (continuing): ${error.message}`);
          // Continue - retry errors don't affect main monitoring or DR processes
        });
      }, Math.min(this.retryBaseDelay, 5000)); // Retry more frequently (max 5s)

      logger.info(`Block monitoring started with retry system - max retries: ${this.maxRetryAttempts}, base delay: ${this.retryBaseDelay}ms [${this.instanceId}]`);
      return Result.ok(undefined);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(`Failed to start block monitoring [${this.instanceId}]: ${err.message}`);
      return Result.err(err);
    }
  }

  async stopMonitoring(): Promise<void> {
    logger.info(`Stopping block monitoring [${this.instanceId}]`);
    
    this.isMonitoring = false;
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }

    // 🚀 NEW: Stop retry system
    if (this.retryIntervalId) {
      clearInterval(this.retryIntervalId);
      this.retryIntervalId = undefined;
    }

    await this.tmClient.match({
      Just: async (client) => {
        client.disconnect();
        this.tmClient = Maybe.nothing();
      },
      Nothing: async () => {}
    });

    // Log final retry statistics
    if (this.failedBlocks.size > 0) {
      logger.warn(`Block monitoring stopped with ${this.failedBlocks.size} unresolved failed blocks: [${Array.from(this.failedBlocks.keys()).join(', ')}]`);
    }

    logger.info(`Block monitoring stopped [${this.instanceId}]`);
  }

  private async getCurrentHeight(): Promise<Result<bigint, Error>> {
    if (this.tmClient.isNothing) {
      return Result.err(new Error("Tendermint client not connected"));
    }

    try {
      const client = this.tmClient.value;
      const latestBlock = await client.block();
      return Result.ok(BigInt(latestBlock.block.header.height));
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return Result.err(err);
    }
  }

  async getLatestBlock(): Promise<Result<BlockEvent, Error>> {
    if (this.tmClient.isNothing) {
      return Result.err(new Error("Tendermint client not connected"));
    }

    try {
      const client = this.tmClient.value;
      
      // Single RPC call to get block results which contains transaction data
      const blockResults = await client.blockResults();
      
      // Create initial block event using just blockResults
      const blockEvent: BlockEvent = {
        height: BigInt(blockResults.height),
        block: null, // We don't need raw block data, only transaction results
        blockResults,
        transactions: [],
      };

      // Parse transactions using TransactionParser
      const enhancedBlockEvent = this.transactionParser.enhanceBlockEvent(blockEvent);
      
      // Add sophisticated logging
      const txResultsCount = (blockResults as any).results?.length || (blockResults as any).txs_results?.length || 0;
      const beginBlockEventsCount = (blockResults as any).beginBlockEvents?.length || 0;
      const endBlockEventsCount = (blockResults as any).endBlockEvents?.length || 0;
      const parsedTxCount = enhancedBlockEvent.transactions.length;
      const sedaTxCount = enhancedBlockEvent.transactions.filter((tx: ParsedTransaction) => 
        tx.messages.some((msg: ParsedMessage) => msg.sedaContext !== undefined)
      ).length;
      
      logger.debug(`Block ${blockResults.height}: tx_results=${txResultsCount}, begin_events=${beginBlockEventsCount}, end_events=${endBlockEventsCount}, parsed_txs=${parsedTxCount}, seda_txs=${sedaTxCount}`);

      return Result.ok(enhancedBlockEvent);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(`Failed to get latest block: ${err.message}`, { error: err.stack });
      return Result.err(err);
    }
  }

  // 🚀 COMPLETELY NON-BLOCKING: Enhanced pollForNewBlocks that never interferes with DR processes
  private async pollForNewBlocks(): Promise<void> {
    if (!this.isMonitoring) return;

    try {
      // 🚀 PERFORMANCE: Get current height without blocking
      const currentHeight = await this.getCurrentHeight();
      if (currentHeight.isErr) {
        logger.warn(`[${this.instanceId}] Failed to get current block height: ${currentHeight.error.message}`);
        return; // Continue running, don't block DR processes
      }

      // Process all blocks since last processed height (only if we're not already processing them)
      const blocksToProcess: bigint[] = [];
      for (let height = this.lastProcessedHeight + 1n; height <= currentHeight.value; height++) {
        if (!this.processingBlocks.has(height) && !this.failedBlocks.has(height)) {
          blocksToProcess.push(height);
        }
      }

      if (blocksToProcess.length > 0) {
        logger.info(`🔄 [${this.instanceId}] Processing ${blocksToProcess.length} new blocks: ${blocksToProcess[0]} to ${blocksToProcess[blocksToProcess.length - 1]}`);
      }

      // 🚀 CRITICAL: Process blocks in background with ZERO blocking of DR processes
      if (blocksToProcess.length > 0) {
        // Fire and forget - never await block processing to avoid blocking DR processes
        setImmediate(() => {
          this.processBlocksInBackground(blocksToProcess, currentHeight.value)
            .catch(error => {
              logger.warn(`[${this.instanceId}] Background block processing error: ${error.message}`);
              // Continue running - don't let block fetch failures affect DR processes
            });
        });
      }
    } catch (error) {
      // 🚀 ISOLATION: Block fetching errors never affect DR processes
      logger.warn(`[${this.instanceId}] Poll error (continuing): ${error}`);
      // Continue running - DR processes are unaffected
    }
  }

  // 🚀 NEW: Background block processing that never blocks the main thread
  private async processBlocksInBackground(blocksToProcess: bigint[], highestHeight: bigint): Promise<void> {
    // Process all new blocks in parallel without any awaiting on the main thread
    const blockPromises = blocksToProcess.map(height => 
      this.processBlockSafely(height).catch(error => {
        // Individual block failures don't stop other blocks from processing
        logger.debug(`[${this.instanceId}] Block ${height} processing failed: ${error.message}`);
      })
    );
    
    // Process in background without blocking any other operations
    await Promise.allSettled(blockPromises);

    // Update lastProcessedHeight to the highest height we've attempted (not necessarily succeeded)
    // This prevents re-processing the same new blocks, while failed blocks are handled by retry system
    this.lastProcessedHeight = highestHeight;
    
    logger.debug(`[${this.instanceId}] Background processing completed for ${blocksToProcess.length} blocks`);
  }

  // 🚀 COMPLETELY ISOLATED: Safe block processing that never affects DR processes
  private async processBlockSafely(height: bigint): Promise<void> {
    // Mark block as being processed
    this.processingBlocks.add(height);
    
    try {
      // 🚀 TIMEOUT PROTECTION: Add timeout to prevent hanging
      const blockEvent = await Promise.race([
        this.getBlockAtHeight(height),
        new Promise<Result<BlockEvent, Error>>((_, reject) => 
          setTimeout(() => reject(new Error(`Block fetch timeout after 30s`)), 30000)
        )
      ]);
      
      if (blockEvent.isOk) {
        const txCount = blockEvent.value.transactions.length;
        const sedaTxCount = blockEvent.value.transactions.filter((tx: ParsedTransaction) => 
          tx.messages.some((msg: ParsedMessage) => msg.sedaContext !== undefined)
        ).length;
        
        if (sedaTxCount > 0) {
          logger.info(`✅ [${this.instanceId}] Block ${height}: ${txCount} transactions (${sedaTxCount} SEDA)`);
        }
        
        // 🚀 NON-BLOCKING: Emit event in next tick to avoid blocking DR processes
        setImmediate(() => {
          try {
            this.emit('newBlock', blockEvent.value);
          } catch (emitError) {
            logger.warn(`[${this.instanceId}] Event emission error for block ${height}: ${emitError}`);
            // Continue - don't let event handling issues affect block processing
          }
        });
        
        // Remove from failed blocks if it was previously failed
        this.failedBlocks.delete(height);
      } else {
        // Block processing failed - add to retry queue
        this.addToFailedBlocks(height, blockEvent.error.message);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.debug(`[${this.instanceId}] Block ${height} fetch error: ${err.message}`);
      this.addToFailedBlocks(height, err.message);
    } finally {
      // Remove from processing set
      this.processingBlocks.delete(height);
    }
  }

  // 🚀 ENHANCED: Smart retry with circuit breaker pattern
  private addToFailedBlocks(height: bigint, errorMessage: string): void {
    const existing = this.failedBlocks.get(height);
    const attempts = existing ? existing.attempts + 1 : 1;
    
    // 🚀 SMART BACKOFF: Faster initial retries, longer delays for persistent failures
    let backoffMs: number;
    if (attempts <= 3) {
      // Quick retries for transient issues: 1s, 2s, 4s
      backoffMs = 1000 * Math.pow(2, attempts - 1);
    } else {
      // Longer delays for persistent issues: 10s, 20s, 40s, max 60s
      backoffMs = Math.min(10000 * Math.pow(2, attempts - 4), 60000);
    }
    
    const nextRetry = new Date(Date.now() + backoffMs);
    
    const failedBlock: FailedBlock = {
      height,
      attempts,
      lastAttempt: new Date(),
      nextRetry,
      error: errorMessage,
    };
    
    this.failedBlocks.set(height, failedBlock);
    
    // Different log levels based on failure type
    if (attempts <= 3) {
      logger.debug(`🔄 [${this.instanceId}] Block ${height} failed (attempt ${attempts}/${this.maxRetryAttempts}): ${errorMessage}. Retry in ${backoffMs}ms`);
    } else {
      logger.warn(`❌ [${this.instanceId}] Block ${height} persistent failure (attempt ${attempts}/${this.maxRetryAttempts}): ${errorMessage}. Retry in ${backoffMs}ms`);
    }
    
    // 🚀 GRACEFUL DEGRADATION: Remove from failed blocks if max attempts exceeded
    if (attempts >= this.maxRetryAttempts) {
      logger.error(`💀 [${this.instanceId}] Block ${height} permanently failed after ${attempts} attempts. Skipping. Last error: ${errorMessage}`);
      this.failedBlocks.delete(height);
      
      // 🚀 RESILIENCE: Don't stop monitoring - continue with next blocks
      logger.info(`[${this.instanceId}] Continuing block monitoring despite failed block ${height}`);
    }
  }

  // 🚀 COMPLETELY NON-BLOCKING: Retry failed blocks without affecting DR processes
  private async retryFailedBlocks(): Promise<void> {
    if (!this.isMonitoring || this.failedBlocks.size === 0) return;

    try {
      const now = new Date();
      const blocksToRetry: bigint[] = [];
      
      // Find blocks ready for retry
      for (const [height, failedBlock] of this.failedBlocks) {
        if (now >= failedBlock.nextRetry && !this.processingBlocks.has(height)) {
          blocksToRetry.push(height);
        }
      }
      
      if (blocksToRetry.length === 0) return;
      
      logger.debug(`🔄 [${this.instanceId}] Retrying ${blocksToRetry.length} failed blocks: [${blocksToRetry.join(', ')}]`);
      
      // 🚀 FIRE-AND-FORGET: Retry blocks in complete background without blocking
      setImmediate(() => {
        this.retryBlocksInBackground(blocksToRetry)
          .catch(error => {
            logger.debug(`[${this.instanceId}] Background retry error: ${error.message}`);
            // Continue - retry failures don't affect DR processes
          });
      });
    } catch (error) {
      // 🚀 ISOLATION: Retry system errors never affect DR processes
      logger.debug(`[${this.instanceId}] Retry system error (continuing): ${error}`);
    }
  }

  // 🚀 NEW: Background retry processing
  private async retryBlocksInBackground(blocksToRetry: bigint[]): Promise<void> {
    // Retry blocks in parallel with individual error handling
    const retryPromises = blocksToRetry.map(height => 
      this.processBlockSafely(height).catch(error => {
        logger.debug(`[${this.instanceId}] Retry failed for block ${height}: ${error.message}`);
        // Individual retry failures don't affect other retries
      })
    );
    
    // Process all retries without blocking
    await Promise.allSettled(retryPromises);
    
    logger.debug(`[${this.instanceId}] Background retry completed for ${blocksToRetry.length} blocks`);
  }

  private async getBlockAtHeight(height: bigint): Promise<Result<BlockEvent, Error>> {
    if (this.tmClient.isNothing) {
      return Result.err(new Error("Tendermint client not connected"));
    }

    try {
      const client = this.tmClient.value;
      
      // Single RPC call to get block results which contains transaction data
      const blockResults = await client.blockResults(Number(height));
      
      // Get transaction results from blockResults - try all possible locations
      const txResults = (blockResults as any).results || 
                       (blockResults as any).txs_results || 
                       (blockResults as any).tx_results ||
                       (blockResults as any).deliverTx ||
                       (blockResults as any).deliver_tx ||
                       [];
      
      // Create initial block event using just blockResults
      const blockEvent: BlockEvent = {
        height,
        block: null, // We don't need raw block data, only transaction results
        blockResults,
        transactions: [],
      };

      // Parse transactions using TransactionParser
      const enhancedBlockEvent = this.transactionParser.enhanceBlockEvent(blockEvent);
      
      // Add sophisticated logging for SEDA transactions
      const txResultsCount = txResults.length;
      const parsedTxCount = enhancedBlockEvent.transactions.length;
             const sedaTxCount = enhancedBlockEvent.transactions.filter((tx: ParsedTransaction) => 
         tx.messages.some((msg: ParsedMessage) => msg.sedaContext !== undefined)
       ).length;
      
      logger.debug(`[${this.instanceId}] Block ${height}: tx_results=${txResultsCount}, parsed_txs=${parsedTxCount}, seda_txs=${sedaTxCount}`);
      
      // Log SEDA transaction details for debugging
      if (sedaTxCount > 0) {
        const sedaTxs = enhancedBlockEvent.transactions.filter((tx: ParsedTransaction) => 
          tx.messages.some((msg: ParsedMessage) => msg.sedaContext !== undefined)
        );
        
        for (const tx of sedaTxs) {
          const sedaMessages = tx.messages.filter((msg: ParsedMessage) => msg.sedaContext !== undefined);
          for (const msg of sedaMessages) {
            logger.debug(`[${this.instanceId}] SEDA transaction: type=${msg.sedaContext?.type}, success=${tx.success}, hash=${tx.hash}`);
          }
        }
      }

      return Result.ok(enhancedBlockEvent);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(`[${this.instanceId}] Failed to get block at height ${height}: ${err.message}`);
      return Result.err(err);
    }
  }

  // 🚀 NEW: Get retry statistics for monitoring
  getRetryStats(): {
    failedBlocks: number;
    oldestFailedBlock?: bigint;
    totalFailedAttempts: number;
  } {
    const totalFailedAttempts = Array.from(this.failedBlocks.values())
      .reduce((sum, block) => sum + block.attempts, 0);
    
    const oldestFailedBlock = Array.from(this.failedBlocks.keys())
      .sort((a, b) => Number(a - b))[0];
    
    return {
      failedBlocks: this.failedBlocks.size,
      oldestFailedBlock,
      totalFailedAttempts,
    };
  }

  isHealthy(): boolean {
    return this.isMonitoring && this.tmClient.isJust;
  }

  getLastProcessedHeight(): bigint {
    return this.lastProcessedHeight;
  }


} 