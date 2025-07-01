import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Result } from "true-myth";
import type { BlockEvent, ParsedTransaction, ParsedMessage } from "./block-monitor";
import type { SedaChain } from "@sedaprotocol/overlay-ts-common";
import { getDataRequests } from "./get-data-requests";

export interface DataRequestEvent {
  type: 'posted' | 'committed' | 'revealed';
  drId: string;
  height: bigint;
  txHash: string;
  data: any;
}

export interface PostedDataRequestEvent extends DataRequestEvent {
  type: 'posted';
  data: {
    version: string;
    execProgramId: string;
    execInputs: Buffer;
    execGasLimit: bigint;
    tallyProgramId: string;
    tallyInputs: Buffer;
    tallyGasLimit: bigint;
    replicationFactor: number;
    consensusFilter: Buffer;
    gasPrice: bigint;
    memo: Buffer;
  };
}

export interface CommittedDataRequestEvent extends DataRequestEvent {
  type: 'committed';
  data: {
    dataRequestId: string;
    publicKey: string;
    commitmentHash: string;
  };
}

export interface RevealedDataRequestEvent extends DataRequestEvent {
  type: 'revealed';
  data: {
    dataRequestId: string;
    publicKey: string;
    revealData: Buffer;
  };
}

// TODO: This needs to be implemented with the actual DR ID generation algorithm
class DataRequestIdGenerator {
  generateDrId(params: any): string {
    // PLACEHOLDER: This needs the actual SEDA DR ID generation algorithm
    // For now, generate a simple hash-based ID
    const input = JSON.stringify(params);
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `dr_${Math.abs(hash).toString(16)}`;
  }
}

export class EventProcessor {
  private drIdGenerator = new DataRequestIdGenerator();

  constructor(private sedaChain: SedaChain) {}

  /**
   * Process all transactions in a block and extract SEDA-related events
   * NOTE: All data extracted from transaction message arguments, NOT blockchain events
   */
  async processBlockTransactions(blockEvent: BlockEvent): Promise<DataRequestEvent[]> {
    const allEvents: DataRequestEvent[] = [];
    const { transactions } = blockEvent;
    const height = blockEvent.height;

    if (!transactions || transactions.length === 0) {
      return allEvents;
    }

    // Process all transactions in parallel
    const transactionEventPromises = transactions.map(async (tx) => {
      try {
        return await this.extractEventsFromTransaction(tx, height);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.warn(`Failed to process transaction ${tx.hash}: ${err.message}`);
        return [];
      }
    });

    const transactionEventResults = await Promise.all(transactionEventPromises);
    
    // Flatten all events from all transactions
    for (const transactionEvents of transactionEventResults) {
      allEvents.push(...transactionEvents);
    }

    logger.debug(`Processed ${transactions.length} transactions in parallel, found ${allEvents.length} total DR events`);
    return allEvents;
  }

  /**
   * Extract SEDA events from a single transaction
   */
  private async extractEventsFromTransaction(tx: ParsedTransaction, height: bigint): Promise<DataRequestEvent[]> {
    const events: DataRequestEvent[] = [];
    
    if (!tx.messages || tx.messages.length === 0) {
      return events;
    }

    // Process all messages in parallel
    const messageEventPromises = tx.messages.map(async (message) => {
      try {
        if (!message.sedaContext) {
          return null;
        }

        switch (message.sedaContext.type) {
          case 'post_data_request':
            const postResult = await this.extractPostDataRequestFromMessage(message, tx.hash, height);
            return postResult.isOk ? postResult.value : null;

          case 'commit_data_result':
            const commitResult = this.extractCommitFromMessage(message, tx.hash, height);
            return commitResult.isOk ? commitResult.value : null;

          case 'reveal_data_result':
            const revealResult = this.extractRevealFromMessage(message, tx.hash, height);
            return revealResult.isOk ? revealResult.value : null;

          default:
            return null;
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.warn(`Failed to extract event from message: ${err.message}`);
        return null;
      }
    });

    const messageEventResults = await Promise.all(messageEventPromises);
    
    // Filter out null results and add to events array
    for (const event of messageEventResults) {
      if (event) {
        events.push(event);
      }
    }

    return events;
  }

  private async extractPostDataRequestFromMessage(
    message: ParsedMessage,
    txHash: string,
    height: bigint
  ): Promise<Result<PostedDataRequestEvent, Error>> {
    try {
      const msgValue = message.value;
      
      if (!msgValue || typeof msgValue !== 'object') {
        return Result.err(new Error("Invalid message value: expected object"));
      }
      
      // First, check if DR ID is already in the event attributes
      const existingDrId = msgValue.dr_id || msgValue.data_request_id || msgValue.id;
      
      // Extract all DR attributes from message arguments
      const postDrData = {
        version: msgValue.version || "1.0.0",
        execProgramId: msgValue.exec_program_id,
        execInputs: Buffer.from(msgValue.exec_inputs || "", 'base64'),
        execGasLimit: BigInt(msgValue.exec_gas_limit || 0),
        tallyProgramId: msgValue.tally_program_id,
        tallyInputs: Buffer.from(msgValue.tally_inputs || "", 'base64'),
        tallyGasLimit: BigInt(msgValue.tally_gas_limit || 0),
        replicationFactor: Number(msgValue.replication_factor || 1),
        consensusFilter: Buffer.from(msgValue.consensus_filter || "", 'base64'),
        gasPrice: BigInt(msgValue.gas_price || 0),
        memo: Buffer.from(msgValue.memo || "", 'base64'),
      };

      // Use existing DR ID if available, otherwise generate one
      const drId = existingDrId || this.drIdGenerator.generateDrId({
        version: postDrData.version,
        exec_program_id: postDrData.execProgramId,
        exec_inputs: postDrData.execInputs.toString('base64'),
        exec_gas_limit: Number(postDrData.execGasLimit),
        tally_program_id: postDrData.tallyProgramId,
        tally_inputs: postDrData.tallyInputs.toString('base64'),
        tally_gas_limit: Number(postDrData.tallyGasLimit),
        replication_factor: postDrData.replicationFactor,
        consensus_filter: postDrData.consensusFilter.toString('base64'),
        gas_price: postDrData.gasPrice.toString(),
        memo: postDrData.memo.toString('base64'),
      });
      
      const event: PostedDataRequestEvent = {
        type: 'posted',
        drId,
        height,
        txHash,
        data: postDrData,
      };
      
      logger.debug(`Extracted post_data_request event: ${drId} ${existingDrId ? '(from event)' : '(generated)'} in tx ${txHash}`);
      return Result.ok(event);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return Result.err(new Error(`Failed to extract post_data_request: ${err.message}`));
    }
  }

  private extractCommitFromMessage(
    message: ParsedMessage,
    txHash: string,
    height: bigint
  ): Result<CommittedDataRequestEvent, Error> {
    try {
      const msgValue = message.value;
      
      if (!msgValue || typeof msgValue !== 'object') {
        return Result.err(new Error("Invalid message value: expected object"));
      }
      
      // Enhanced data extraction with multiple strategies
      const extractionResult = this.extractSmartContractEventData(msgValue, message.sedaContext, 'commit');
      
      if (!extractionResult.success) {
        logger.warn(`Failed to extract commit data: ${extractionResult.reason}. Message value keys: ${Object.keys(msgValue).join(', ')}`);
        return Result.err(new Error(`Missing commit data: ${extractionResult.reason}`));
      }

      const commitData = {
        dataRequestId: extractionResult.drId!,
        publicKey: extractionResult.publicKey!,
        commitmentHash: extractionResult.commitmentHash || "unknown",
      };

      const event: CommittedDataRequestEvent = {
        type: 'committed',
        drId: commitData.dataRequestId,
        height,
        txHash,
        data: commitData,
      };

      logger.info(`✅ Extracted commit_data_result event: DR ${commitData.dataRequestId} by ${commitData.publicKey} in tx ${txHash}`);
      return Result.ok(event);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return Result.err(new Error(`Failed to extract commit_data_result: ${err.message}`));
    }
  }

  private extractRevealFromMessage(
    message: ParsedMessage,
    txHash: string,
    height: bigint
  ): Result<RevealedDataRequestEvent, Error> {
    try {
      const msgValue = message.value;
      
      // 🚨 DEBUGGING: Log reveal message processing
      logger.info(`🔍 DEBUGGING REVEAL EXTRACTION: Processing reveal message in tx ${txHash}`);
      logger.info(`🔍 DEBUGGING: Message value keys: ${msgValue ? Object.keys(msgValue).join(', ') : 'null'}`);
      logger.info(`🔍 DEBUGGING: SEDA context: ${JSON.stringify(message.sedaContext)}`);
      
      if (!msgValue || typeof msgValue !== 'object') {
        logger.warn(`🔍 DEBUGGING: Invalid message value for reveal in tx ${txHash}`);
        return Result.err(new Error("Invalid message value: expected object"));
      }
      
      // Enhanced data extraction with multiple strategies
      const extractionResult = this.extractSmartContractEventData(msgValue, message.sedaContext, 'reveal');
      
      // 🚨 DEBUGGING: Log extraction result
      logger.info(`🔍 DEBUGGING REVEAL EXTRACTION: Result - success: ${extractionResult.success}, drId: ${extractionResult.drId}, publicKey: ${extractionResult.publicKey}, reason: ${extractionResult.reason}`);
      
      if (!extractionResult.success) {
        logger.warn(`Failed to extract reveal data: ${extractionResult.reason}. Message value keys: ${Object.keys(msgValue).join(', ')}`);
        logger.warn(`🔍 DEBUGGING: Raw message value: ${JSON.stringify(msgValue, null, 2)}`);
        return Result.err(new Error(`Missing reveal data: ${extractionResult.reason}`));
      }

      const revealData = {
        dataRequestId: extractionResult.drId!,
        publicKey: extractionResult.publicKey!,
        revealData: Buffer.from(extractionResult.revealData || "", 'base64'),
      };

      const event: RevealedDataRequestEvent = {
        type: 'revealed',
        drId: revealData.dataRequestId,
        height,
        txHash,
        data: revealData,
      };

      logger.info(`🎉 DEBUGGING: Successfully extracted reveal_data_result event: ${revealData.dataRequestId} by ${revealData.publicKey} in tx ${txHash}`);
      return Result.ok(event);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(`🔍 DEBUGGING: Error extracting reveal from tx ${txHash}: ${err.message}`);
      return Result.err(new Error(`Failed to extract reveal_data_result: ${err.message}`));
    }
  }

  /**
   * Smart extraction of smart contract event data with comprehensive fallback strategies
   */
  private extractSmartContractEventData(
    msgValue: any, 
    sedaContext: any,
    eventType: 'commit' | 'reveal'
  ): {
    success: boolean;
    drId?: string;
    publicKey?: string;
    commitmentHash?: string;
    revealData?: string;
    reason?: string;
  } {
    // Extract DR ID using multiple strategies
    const drId = 
      msgValue.dr_id ||
      msgValue.data_request_id ||
      msgValue.dataRequestId ||
      sedaContext?.drId;

    if (!drId) {
      return { 
        success: false, 
        reason: 'Missing data request ID' 
      };
    }

    // Extract public key/executor using multiple strategies
    const publicKey = 
      msgValue.public_key ||
      msgValue.publicKey ||
      msgValue.executor ||
      msgValue.sender ||
      sedaContext?.publicKey ||
      sedaContext?.executor ||
      sedaContext?.sender;

    if (!publicKey) {
      return { 
        success: false, 
        reason: 'Missing public key/executor address' 
      };
    }

    let commitmentHash: string | undefined;
    let revealData: string | undefined;

    if (eventType === 'commit') {
      // Extract commitment hash for commit events
      commitmentHash = 
        msgValue.commitment ||
        msgValue.commitment_hash ||
        msgValue.commitmentHash ||
        msgValue.proof ||
        sedaContext?.commitmentHash;
    } else if (eventType === 'reveal') {
      // Extract reveal data for reveal events
      revealData = 
        msgValue.reveal_data ||
        msgValue.revealData ||
        msgValue.reveal ||
        msgValue.result ||
        sedaContext?.revealData;
    }

    return {
      success: true,
      drId,
      publicKey,
      commitmentHash,
      revealData
    };
  }


} 