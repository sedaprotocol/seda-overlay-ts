import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Maybe, Result } from "true-myth";
import type { BlockEvent, ParsedTransaction, ParsedMessage } from "./block-monitor";
import { TransactionParser } from "./transaction-parser";
import { DataRequestIdGenerator } from "./dr-id-generator";

export interface DataRequestEvent {
  type: 'posted' | 'committed' | 'revealed';
  drId: string;
  height: bigint;
  txHash: string;
  data: any; // Transaction argument data specific to event type
}

export class EventProcessor {
  private transactionParser: TransactionParser;
  private drIdGenerator: DataRequestIdGenerator;

  constructor() {
    this.transactionParser = new TransactionParser();
    this.drIdGenerator = new DataRequestIdGenerator();
  }

  /**
   * Process all transactions in a block and extract DR events from transaction arguments
   * NOTE: We parse message arguments, NOT blockchain events
   */
  async processBlockTransactions(blockEvent: BlockEvent): Promise<DataRequestEvent[]> {
    const events: DataRequestEvent[] = [];
    
    // Enhance block event with parsed transactions if not already done
    const enhancedBlock = this.transactionParser.enhanceBlockEvent(blockEvent);
    
    for (const tx of enhancedBlock.transactions) {
      if (!tx.success) {
        // Skip failed transactions
        continue;
      }

      try {
        // Extract DR events from successful transaction
        const txEvents = await this.extractEventsFromTransaction(tx, blockEvent.height);
        events.push(...txEvents);
      } catch (error) {
        logger.warn("Failed to extract events from transaction");
      }
    }

    if (events.length > 0) {
      logger.debug("Extracted DR events from block");
    }

    return events;
  }

  private async extractEventsFromTransaction(
    tx: ParsedTransaction, 
    height: bigint
  ): Promise<DataRequestEvent[]> {
    const events: DataRequestEvent[] = [];

    for (const message of tx.messages) {
      if (!message.sedaContext) continue;

      try {
        switch (message.sedaContext.type) {
          case 'post_data_request':
            const postedEvents = await this.extractPostDataRequestFromTx(tx, message, height);
            events.push(...postedEvents);
            break;

          case 'commit_data_result':
            const commitEvents = this.extractCommitFromTx(tx, message, height);
            events.push(...commitEvents);
            break;

          case 'reveal_data_result':
            const revealEvents = this.extractRevealFromTx(tx, message, height);
            events.push(...revealEvents);
            break;
        }
      } catch (error) {
        logger.warn("Failed to extract event from message");
      }
    }

    return events;
  }

  /**
   * Extract post_data_request events from transaction arguments
   */
  private async extractPostDataRequestFromTx(
    tx: ParsedTransaction, 
    message: ParsedMessage, 
    height: bigint
  ): Promise<DataRequestEvent[]> {
    // Extract DR attributes from transaction arguments
    const drAttributes = this.transactionParser.extractDataRequestAttributes(message);
    if (!drAttributes) {
      logger.warn("Could not extract DR attributes from post_data_request");
      return [];
    }

    try {
      // Generate DR ID from transaction arguments
      const drId = this.drIdGenerator.generateDrId(drAttributes);
      
      const event: DataRequestEvent = {
        type: 'posted',
        drId,
        height,
        txHash: tx.hash,
        data: drAttributes // All DR parameters from transaction arguments
      };

      logger.debug("Extracted post_data_request event");
      return [event];
    } catch (error) {
      logger.error("Failed to generate DR ID from transaction arguments");
      return [];
    }
  }

  /**
   * Extract commit_data_result events from transaction arguments
   */
  private extractCommitFromTx(
    tx: ParsedTransaction, 
    message: ParsedMessage, 
    height: bigint
  ): DataRequestEvent[] {
    // Extract commit attributes from transaction arguments
    const commitAttributes = this.transactionParser.extractDataRequestAttributes(message);
    if (!commitAttributes?.data_request_id) {
      logger.warn("Could not extract commit attributes from transaction");
      return [];
    }

    const event: DataRequestEvent = {
      type: 'committed',
      drId: commitAttributes.data_request_id,
      height,
      txHash: tx.hash,
      data: commitAttributes // Commit data from transaction arguments
    };

    logger.debug("Extracted commit_data_result event");
    return [event];
  }

  /**
   * Extract reveal_data_result events from transaction arguments  
   */
  private extractRevealFromTx(
    tx: ParsedTransaction, 
    message: ParsedMessage, 
    height: bigint
  ): DataRequestEvent[] {
    // Extract reveal attributes from transaction arguments
    const revealAttributes = this.transactionParser.extractDataRequestAttributes(message);
    if (!revealAttributes?.data_request_id) {
      logger.warn("Could not extract reveal attributes from transaction");
      return [];
    }

    const event: DataRequestEvent = {
      type: 'revealed',
      drId: revealAttributes.data_request_id,
      height,
      txHash: tx.hash,
      data: revealAttributes // Reveal data from transaction arguments
    };

    logger.debug("Extracted reveal_data_result event");
    return [event];
  }
} 