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
      this.intervalId = setInterval(() => {
        this.pollForNewBlocks().catch((error) => {
          logger.error("Error polling for new blocks");
          this.emit('error', error);
        });
      }, this.pollInterval);

      // 🚀 NEW: Start retry system for failed blocks
      this.retryIntervalId = setInterval(() => {
        this.retryFailedBlocks().catch((error) => {
          logger.error("Error retrying failed blocks");
        });
      }, this.retryBaseDelay);

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

  // 🚀 NEW: Enhanced pollForNewBlocks with proper retry handling
  private async pollForNewBlocks(): Promise<void> {
    if (!this.isMonitoring) return;

    const currentHeight = await this.getCurrentHeight();
    if (currentHeight.isErr) {
      logger.error("Failed to get current block height");
      return;
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

    // Process all new blocks in parallel
    const blockPromises = blocksToProcess.map(height => this.processBlockSafely(height));
    
    if (blockPromises.length > 0) {
      await Promise.allSettled(blockPromises);
    }

    // Update lastProcessedHeight to the highest height we've attempted (not necessarily succeeded)
    // This prevents re-processing the same new blocks, while failed blocks are handled by retry system
    if (blocksToProcess.length > 0) {
      this.lastProcessedHeight = currentHeight.value;
    }
  }

  // 🚀 NEW: Safe block processing with error handling and retry tracking
  private async processBlockSafely(height: bigint): Promise<void> {
    // Mark block as being processed
    this.processingBlocks.add(height);
    
    try {
      const blockEvent = await this.getBlockAtHeight(height);
      
      if (blockEvent.isOk) {
        const txCount = blockEvent.value.transactions.length;
                 const sedaTxCount = blockEvent.value.transactions.filter((tx: ParsedTransaction) => 
           tx.messages.some((msg: ParsedMessage) => msg.sedaContext !== undefined)
         ).length;
        
        if (sedaTxCount > 0) {
          logger.info(`✅ [${this.instanceId}] Block ${height}: ${txCount} transactions (${sedaTxCount} SEDA)`);
        }
        
        // Emit the block event
        this.emit('newBlock', blockEvent.value);
        
        // Remove from failed blocks if it was previously failed
        this.failedBlocks.delete(height);
      } else {
        // Block processing failed - add to retry queue
        this.addToFailedBlocks(height, blockEvent.error.message);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.addToFailedBlocks(height, err.message);
    } finally {
      // Remove from processing set
      this.processingBlocks.delete(height);
    }
  }

  // 🚀 NEW: Add block to failed blocks with exponential backoff
  private addToFailedBlocks(height: bigint, errorMessage: string): void {
    const existing = this.failedBlocks.get(height);
    const attempts = existing ? existing.attempts + 1 : 1;
    
    // Exponential backoff: 2s, 4s, 8s, 16s, 32s, then cap at 60s
    const backoffMs = Math.min(this.retryBaseDelay * Math.pow(2, attempts - 1), 60000);
    const nextRetry = new Date(Date.now() + backoffMs);
    
    const failedBlock: FailedBlock = {
      height,
      attempts,
      lastAttempt: new Date(),
      nextRetry,
      error: errorMessage,
    };
    
    this.failedBlocks.set(height, failedBlock);
    
    logger.warn(`❌ [${this.instanceId}] Block ${height} failed (attempt ${attempts}/${this.maxRetryAttempts}): ${errorMessage}. Next retry in ${backoffMs}ms`);
    
    // Remove from failed blocks if max attempts exceeded
    if (attempts >= this.maxRetryAttempts) {
      logger.error(`💀 [${this.instanceId}] Block ${height} permanently failed after ${attempts} attempts. Last error: ${errorMessage}`);
      this.failedBlocks.delete(height);
    }
  }

  // 🚀 NEW: Retry failed blocks independently
  private async retryFailedBlocks(): Promise<void> {
    if (!this.isMonitoring || this.failedBlocks.size === 0) return;

    const now = new Date();
    const blocksToRetry: bigint[] = [];
    
    // Find blocks ready for retry
    for (const [height, failedBlock] of this.failedBlocks) {
      if (now >= failedBlock.nextRetry && !this.processingBlocks.has(height)) {
        blocksToRetry.push(height);
      }
    }
    
    if (blocksToRetry.length === 0) return;
    
    logger.info(`🔄 [${this.instanceId}] Retrying ${blocksToRetry.length} failed blocks: [${blocksToRetry.join(', ')}]`);
    
    // Retry blocks in parallel
    const retryPromises = blocksToRetry.map(height => this.processBlockSafely(height));
    await Promise.allSettled(retryPromises);
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