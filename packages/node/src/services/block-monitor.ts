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
    this.transactionParser = new TransactionParser();
    this.instanceId = Math.random().toString(36).substring(2, 8);
  }

  async startMonitoring(): Promise<Result<void, Error>> {
    try {
      logger.info(`Starting block monitoring with optimized polling [${this.instanceId}]`);

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

      logger.info(`Block monitoring started [${this.instanceId}]`);
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

    await this.tmClient.match({
      Just: async (client) => {
        client.disconnect();
        this.tmClient = Maybe.nothing();
      },
      Nothing: async () => {}
    });

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
      const sedaTxCount = enhancedBlockEvent.transactions.filter(tx => 
        tx.messages.some(msg => msg.sedaContext !== undefined)
      ).length;
      
      logger.debug(`Block ${blockResults.height}: tx_results=${txResultsCount}, begin_events=${beginBlockEventsCount}, end_events=${endBlockEventsCount}, parsed_txs=${parsedTxCount}, seda_txs=${sedaTxCount}`);

      return Result.ok(enhancedBlockEvent);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(`Failed to get latest block: ${err.message}`, { error: err.stack });
      return Result.err(err);
    }
  }

  private async pollForNewBlocks(): Promise<void> {
    if (!this.isMonitoring) return;

    const currentHeight = await this.getCurrentHeight();
    if (currentHeight.isErr) {
      logger.error("Failed to get current block height");
      return;
    }

    // Process all blocks since last processed height
    const blocksToProcess = currentHeight.value - this.lastProcessedHeight;
    if (blocksToProcess > 0n) {
      logger.debug(`[${this.instanceId}] Processing ${blocksToProcess} new blocks (${this.lastProcessedHeight + 1n} to ${currentHeight.value}) - NON-BLOCKING`);
    }

    // Process all blocks in background without blocking ongoing operations
    const blockPromises: Promise<void>[] = [];
    
    for (let height = this.lastProcessedHeight + 1n; height <= currentHeight.value; height++) {
      const blockPromise = (async (blockHeight: bigint) => {
        // Use setImmediate to ensure each block processing doesn't block the event loop
        setImmediate(async () => {
          try {
            const blockEvent = await this.getBlockAtHeight(blockHeight);
            if (blockEvent.isOk) {
              const txCount = blockEvent.value.transactions.length;
              const sedaTxCount = blockEvent.value.transactions.filter(tx => 
                tx.messages.some(msg => msg.sedaContext !== undefined)
              ).length;
              
              logger.debug(`[${this.instanceId}] Emitting block ${blockHeight}: ${txCount} transactions (${sedaTxCount} SEDA) - NON-BLOCKING`);
              
              // Emit the block event immediately without blocking
              setImmediate(() => {
                this.emit('newBlock', blockEvent.value);
              });
            }
          } catch (error) {
            logger.error(`Error processing block ${blockHeight}: ${error}`);
          }
        });
      })(height);
      
      blockPromises.push(blockPromise);
    }
    
    // Process all blocks in background - don't block the polling loop
    Promise.all(blockPromises).then(() => {
      logger.debug(`[${this.instanceId}] Completed background processing of ${blocksToProcess} blocks`);
    }).catch((error) => {
      logger.error(`[${this.instanceId}] Error in background block processing: ${error}`);
    });
    
    // Update last processed height immediately so we don't reprocess the same blocks
    this.lastProcessedHeight = currentHeight.value;
    
    // Return immediately without waiting for processing to complete
    logger.debug(`[${this.instanceId}] Queued ${blocksToProcess} blocks for background processing, continuing...`);
  }

  private async getBlockAtHeight(height: bigint): Promise<Result<BlockEvent, Error>> {
    if (this.tmClient.isNothing) {
      return Result.err(new Error("Tendermint client not connected"));
    }

    try {
      const client = this.tmClient.value;
      
      // Single RPC call to get block results which contains transaction data
      const blockResults = await client.blockResults(Number(height));
      // Check all possible transaction result fields
      const possibleTxFields = [
        'results', 'txs_results', 'tx_results', 'transactions', 
        'deliverTx', 'deliver_tx', 'txResults', 'transactionResults'
      ];
      
      for (const field of possibleTxFields) {
        const value = (blockResults as any)[field];
        if (value !== undefined) {
          logger.debug(`[${this.instanceId}] Found field '${field}': type=${typeof value}, length=${Array.isArray(value) ? value.length : 'not array'}`);
          if (Array.isArray(value) && value.length > 0) {
            logger.debug(`[${this.instanceId}] Field '${field}' has ${value.length} items, first item keys: ${Object.keys(value[0] || {}).join(', ')}`);
          }
        }
      }
            
      // Get transaction results from blockResults - try all possible locations
      const txResults = (blockResults as any).results || 
                       (blockResults as any).txs_results || 
                       (blockResults as any).tx_results ||
                       (blockResults as any).deliverTx ||
                       (blockResults as any).deliver_tx ||
                       [];
      
      logger.debug(`[${this.instanceId}] Using transaction results: ${txResults.length} items`);
      
      if (txResults.length > 0) {
        // Log detailed structure of transaction results
        for (let i = 0; i < Math.min(txResults.length, 3); i++) {
          const txResult = txResults[i];
          const safeTxResult = this.createSafeLoggingObject(txResult);
        }
      }
      
      // Create initial block event using just blockResults
      const blockEvent: BlockEvent = {
        height,
        block: null, // We don't need raw block data, only transaction results
        blockResults,
        transactions: [],
      };

      // Parse transactions using TransactionParser
      logger.debug(`[${this.instanceId}] About to parse transactions for block ${height}`);
      const enhancedBlockEvent = this.transactionParser.enhanceBlockEvent(blockEvent);
      logger.debug(`[${this.instanceId}] TransactionParser returned ${enhancedBlockEvent.transactions.length} transactions`);
      
      // Add sophisticated logging
      const txResultsCount = txResults.length;
      const beginBlockEventsCount = (blockResults as any).beginBlockEvents?.length || 0;
      const endBlockEventsCount = (blockResults as any).endBlockEvents?.length || 0;
      const parsedTxCount = enhancedBlockEvent.transactions.length;
      const sedaTxCount = enhancedBlockEvent.transactions.filter(tx => 
        tx.messages.some(msg => msg.sedaContext !== undefined)
      ).length;
      
      logger.info(`[${this.instanceId}] Block ${height}: tx_results=${txResultsCount}, begin_events=${beginBlockEventsCount}, end_events=${endBlockEventsCount}, parsed_txs=${parsedTxCount}, seda_txs=${sedaTxCount}`);
      
      // Log transaction details if we have any
      if (txResultsCount > 0) {
        const txDetails = txResults.map((txResult: any, index: number) => ({
          index,
          code: txResult?.code,
          success: txResult?.code === 0,
          events: txResult?.events?.length || 0,
          log: txResult?.log?.substring(0, 100) || 'no log'
        }));
        
        // Log transaction details if we have SEDA transactions
        if (sedaTxCount > 0) {
          const sedaTxs = enhancedBlockEvent.transactions.filter(tx => 
            tx.messages.some(msg => msg.sedaContext !== undefined)
          );
          
          for (const tx of sedaTxs) {
            const sedaMessages = tx.messages.filter(msg => msg.sedaContext !== undefined);
            for (const msg of sedaMessages) {
              logger.info(`[${this.instanceId}] SEDA transaction found: type=${msg.sedaContext?.type}, success=${tx.success}, hash=${tx.hash}`);
            }
          }
        } else if (parsedTxCount > 0) {
          // Log details about non-SEDA transactions to understand what we're getting
          const nonSedaTxDetails = enhancedBlockEvent.transactions.map(tx => ({
            hash: tx.hash,
            success: tx.success,
            messageCount: tx.messages.length,
            messageTypes: tx.messages.map(msg => msg.typeUrl)
          }));
          logger.debug(`[${this.instanceId}] Non-SEDA transactions in block ${height}: ${JSON.stringify(nonSedaTxDetails, null, 2)}`);
        }
      } else {
        logger.debug(`[${this.instanceId}] Block ${height} has no transactions`);
      }

      return Result.ok(enhancedBlockEvent);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(`[${this.instanceId}] Failed to get block at height ${height}: ${err.message}`);
      if (err.stack) {
        logger.debug(`[${this.instanceId}] Error stack: ${err.stack}`);
      }
      return Result.err(err);
    }
  }

  /**
   * Create a safe object for logging that handles BigInt and other non-serializable values
   */
  private createSafeLoggingObject(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }
    
    if (typeof obj === 'bigint') {
      return obj.toString();
    }
    
    if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') {
      return obj;
    }
    
    if (Array.isArray(obj)) {
      return obj.slice(0, 5).map(item => this.createSafeLoggingObject(item)); // Limit array size for logging
    }
    
    if (typeof obj === 'object') {
      const safeObj: any = {};
      const keys = Object.keys(obj).slice(0, 20); // Limit number of keys for logging
      
      for (const key of keys) {
        try {
          safeObj[key] = this.createSafeLoggingObject(obj[key]);
        } catch (error) {
          safeObj[key] = `[Error: ${error}]`;
        }
      }
      
      if (Object.keys(obj).length > 20) {
        safeObj['...'] = `[${Object.keys(obj).length - 20} more keys]`;
      }
      
      return safeObj;
    }
    
    return String(obj);
  }

  isHealthy(): boolean {
    return this.isMonitoring && this.tmClient.isJust;
  }

  getLastProcessedHeight(): bigint {
    return this.lastProcessedHeight;
  }
} 