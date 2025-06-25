import { logger } from "@sedaprotocol/overlay-ts-logger";
import { EventEmitter } from "eventemitter3";
import { Maybe, Result } from "true-myth";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { Tendermint37Client } from "@cosmjs/tendermint-rpc";

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
  private isMonitoring = false;
  private lastProcessedHeight: bigint = 0n;
  private pollInterval: number;
  private intervalId?: ReturnType<typeof setInterval>;

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
  }

  async startMonitoring(): Promise<Result<void, Error>> {
    try {
      logger.info("Starting block monitoring with optimized polling");

      // Create Tendermint client for block operations
      const rpcEndpoint = this.appConfig.sedaChain.rpc;
      logger.info(`Connecting to Tendermint RPC at ${rpcEndpoint}`);
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

      logger.info("Block monitoring started");
      return Result.ok(undefined);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error("Failed to start block monitoring");
      return Result.err(err);
    }
  }

  async stopMonitoring(): Promise<void> {
    logger.info("Stopping block monitoring");
    
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

    logger.info("Block monitoring stopped");
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
      
      const blockEvent: BlockEvent = {
        height: BigInt(blockResponse.block.header.height),
        block: blockResponse.block,
        blockResults,
        transactions: [], // Will be populated by TransactionParser
      };

      return Result.ok(blockEvent);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
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
    for (let height = this.lastProcessedHeight + 1n; height <= currentHeight.value; height++) {
      try {
        const blockEvent = await this.getBlockAtHeight(height);
        if (blockEvent.isOk) {
          logger.debug(`Processing block ${height} with ${blockEvent.value.transactions.length} transactions`);
          this.emit('newBlock', blockEvent.value);
          this.lastProcessedHeight = height;
        }
      } catch (error) {
        logger.error(`Error processing block ${height}`);
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
      
      const blockEvent: BlockEvent = {
        height,
        block: blockResponse.block,
        blockResults,
        transactions: [], // Will be populated by TransactionParser
      };

      return Result.ok(blockEvent);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
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