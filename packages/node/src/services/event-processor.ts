import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Result } from "true-myth";
import type { BlockEvent, ParsedTransaction, ParsedMessage } from "./block-monitor";
import { DataRequestIdGenerator } from "./dr-id-generator";

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
    commitment: string;
    publicKey: string;
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

export class EventProcessor {
  private drIdGenerator: DataRequestIdGenerator;

  constructor() {
    this.drIdGenerator = new DataRequestIdGenerator();
  }

  /**
   * Process all transactions in a block and extract SEDA-related events
   * NOTE: All data extracted from transaction message arguments, NOT blockchain events
   */
  async processBlockTransactions(blockEvent: BlockEvent): Promise<DataRequestEvent[]> {
    const events: DataRequestEvent[] = [];

    for (const tx of blockEvent.transactions) {
      if (!tx.success) {
        continue; // Skip failed transactions
      }

      try {
        // Extract events from each transaction
        const txEvents = await this.extractEventsFromTransaction(tx, blockEvent.height);
        events.push(...txEvents);
      } catch (error) {
        logger.error(`Failed to process transaction ${tx.hash}`, { error: error instanceof Error ? error.message : String(error) });
      }
    }

    logger.debug(`Processed ${blockEvent.transactions.length} transactions, found ${events.length} SEDA events`);
    return events;
  }

  private async extractEventsFromTransaction(
    tx: ParsedTransaction, 
    height: bigint
  ): Promise<DataRequestEvent[]> {
    const events: DataRequestEvent[] = [];

    for (const message of tx.messages) {
      if (!message.sedaContext) {
        continue; // Not a SEDA message
      }

      try {
        switch (message.sedaContext.type) {
          case 'post_data_request':
            const postedEvent = this.extractPostDataRequestFromMessage(message, tx.hash, height);
            if (postedEvent.isOk) {
              events.push(postedEvent.value);
            }
            break;

          case 'commit_data_result':
            const commitEvent = this.extractCommitFromMessage(message, tx.hash, height);
            if (commitEvent.isOk) {
              events.push(commitEvent.value);
            }
            break;

          case 'reveal_data_result':
            const revealEvent = this.extractRevealFromMessage(message, tx.hash, height);
            if (revealEvent.isOk) {
              events.push(revealEvent.value);
            }
            break;
        }
      } catch (error) {
        logger.error(`Failed to extract event from message type ${message.sedaContext.type}`, { error: error instanceof Error ? error.message : String(error) });
      }
    }

    return events;
  }

  private extractPostDataRequestFromMessage(
    message: ParsedMessage,
    txHash: string,
    height: bigint
  ): Result<PostedDataRequestEvent, Error> {
    try {
      const msgValue = message.value;
      
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

      // Generate DR ID from message arguments
      const drId = this.drIdGenerator.generateDrId({
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

      logger.debug(`Extracted post_data_request event: ${drId} in tx ${txHash}`);
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
      
      const commitData = {
        dataRequestId: msgValue.data_request_id,
        commitment: msgValue.commitment,
        publicKey: msgValue.public_key || message.sedaContext?.publicKey || "",
      };

      if (!commitData.dataRequestId || !commitData.commitment) {
        return Result.err(new Error("Missing required commit data"));
      }

      const event: CommittedDataRequestEvent = {
        type: 'committed',
        drId: commitData.dataRequestId,
        height,
        txHash,
        data: commitData,
      };

      logger.debug(`Extracted commit_data_result event: ${commitData.dataRequestId} by ${commitData.publicKey} in tx ${txHash}`);
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
      
      const revealData = {
        dataRequestId: msgValue.data_request_id,
        publicKey: msgValue.public_key || message.sedaContext?.publicKey || "",
        revealData: Buffer.from(msgValue.reveal_data || "", 'base64'),
      };

      if (!revealData.dataRequestId || !revealData.publicKey) {
        return Result.err(new Error("Missing required reveal data"));
      }

      const event: RevealedDataRequestEvent = {
        type: 'revealed',
        drId: revealData.dataRequestId,
        height,
        txHash,
        data: revealData,
      };

      logger.debug(`Extracted reveal_data_result event: ${revealData.dataRequestId} by ${revealData.publicKey} in tx ${txHash}`);
      return Result.ok(event);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return Result.err(new Error(`Failed to extract reveal_data_result: ${err.message}`));
    }
  }
} 