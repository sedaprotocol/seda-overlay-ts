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
      const blockResponse = await client.block();
      const blockResults = await client.blockResults(blockResponse.block.header.height);
      
      // Create initial block event
      const blockEvent: BlockEvent = {
        height: BigInt(blockResponse.block.header.height),
        block: blockResponse.block,
        blockResults,
        transactions: [],
      };

      // Parse transactions using TransactionParser
      const enhancedBlockEvent = this.transactionParser.enhanceBlockEvent(blockEvent);
      
      // Add sophisticated logging
      const rawTxCount = (blockResponse.block as any).data?.txs?.length || 0;
      const parsedTxCount = enhancedBlockEvent.transactions.length;
      const sedaTxCount = enhancedBlockEvent.transactions.filter(tx => 
        tx.messages.some(msg => msg.sedaContext !== undefined)
      ).length;
      
      logger.debug(`Block ${blockResponse.block.header.height}: raw_txs=${rawTxCount}, parsed_txs=${parsedTxCount}, seda_txs=${sedaTxCount}`);

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
      logger.debug(`[${this.instanceId}] Processing ${blocksToProcess} new blocks (${this.lastProcessedHeight + 1n} to ${currentHeight.value})`);
    }

    for (let height = this.lastProcessedHeight + 1n; height <= currentHeight.value; height++) {
      try {
        const blockEvent = await this.getBlockAtHeight(height);
        if (blockEvent.isOk) {
          const txCount = blockEvent.value.transactions.length;
          const sedaTxCount = blockEvent.value.transactions.filter(tx => 
            tx.messages.some(msg => msg.sedaContext !== undefined)
          ).length;
          
          logger.debug(`[${this.instanceId}] Emitting block ${height}: ${txCount} transactions (${sedaTxCount} SEDA)`);
          this.emit('newBlock', blockEvent.value);
          this.lastProcessedHeight = height;
        }
      } catch (error) {
        logger.error(`Error processing block ${height}: ${error}`);
      }
    }
  }

  private async getBlockAtHeight(height: bigint): Promise<Result<BlockEvent, Error>> {
    if (this.tmClient.isNothing) {
      return Result.err(new Error("Tendermint client not connected"));
    }

    try {
      const client = this.tmClient.value;
      const blockResponse = await client.block(Number(height));
      const blockResults = await client.blockResults(Number(height));
      
      // SOPHISTICATED LOGGING: Log full block structure
      logger.debug(`[${this.instanceId}] Raw blockResponse structure - keys: ${Object.keys(blockResponse).join(', ')}`);
      logger.debug(`[${this.instanceId}] Block keys: ${Object.keys(blockResponse.block || {}).join(', ')}`);
      logger.debug(`[${this.instanceId}] Header keys: ${Object.keys(blockResponse.block?.header || {}).join(', ')}`);
      logger.debug(`[${this.instanceId}] Data keys: ${Object.keys((blockResponse.block as any)?.data || {}).join(', ')}`);
      
      // Log the full block data structure
      const blockDataForLogging = {
        block: {
          header: blockResponse.block.header,
          data: (blockResponse.block as any).data,
          evidence: (blockResponse.block as any).evidence,
          lastCommit: (blockResponse.block as any).last_commit
        }
      };
      logger.debug(`[${this.instanceId}] Full block ${height} contents: ${JSON.stringify(blockDataForLogging, null, 2)}`);
      
      // Log block results structure  
      logger.debug(`[${this.instanceId}] Block results keys: ${Object.keys(blockResults || {}).join(', ')}`);
      logger.debug(`[${this.instanceId}] Block results txs_results length: ${(blockResults as any)?.txs_results?.length || 0}`);
      logger.debug(`[${this.instanceId}] Block results results length: ${(blockResults as any)?.results?.length || 0}`);
      
      // Create initial block event
      const blockEvent: BlockEvent = {
        height,
        block: blockResponse.block,
        blockResults,
        transactions: [],
      };

      // Parse transactions using TransactionParser
      logger.debug(`[${this.instanceId}] About to parse transactions for block ${height}`);
      const enhancedBlockEvent = this.transactionParser.enhanceBlockEvent(blockEvent);
      logger.debug(`[${this.instanceId}] TransactionParser returned ${enhancedBlockEvent.transactions.length} transactions`);
      
      // Add sophisticated logging
      const rawTxCount = (blockResponse.block as any).data?.txs?.length || 0;
      const parsedTxCount = enhancedBlockEvent.transactions.length;
      const sedaTxCount = enhancedBlockEvent.transactions.filter(tx => 
        tx.messages.some(msg => msg.sedaContext !== undefined)
      ).length;
      
      logger.info(`[${this.instanceId}] Block ${height}: raw_txs=${rawTxCount}, parsed_txs=${parsedTxCount}, seda_txs=${sedaTxCount}`);
      
              // Log raw transaction data if we have any
        if (rawTxCount > 0) {
          const rawTxs = (blockResponse.block as any).data?.txs || [];
          const txDetails = rawTxs.map((tx: any, index: number) => ({
            index,
            type: typeof tx,
            length: tx?.length || 'unknown',
            isString: typeof tx === 'string',
            isBuffer: Buffer.isBuffer(tx),
            isArray: Array.isArray(tx),
            firstBytes: typeof tx === 'string' ? tx.substring(0, 100) : 'not string'
          }));
          logger.debug(`[${this.instanceId}] Raw transactions in block ${height}: ${JSON.stringify(txDetails, null, 2)}`);
        
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



  isHealthy(): boolean {
    return this.isMonitoring && this.tmClient.isJust;
  }

  getLastProcessedHeight(): bigint {
    return this.lastProcessedHeight;
  }
} 