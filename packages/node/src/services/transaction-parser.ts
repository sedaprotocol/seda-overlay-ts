import { fromBase64, fromUtf8 } from "@cosmjs/encoding";
import { decodeTxRaw } from "@cosmjs/proto-signing";
import type { Block, BlockResultsResponse } from "@cosmjs/tendermint-rpc/build/tendermint37";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Maybe, Result } from "true-myth";
import type { BlockEvent, ParsedMessage, ParsedTransaction, SedaMessageContext } from "./block-monitor";

export class TransactionParser {
  parseBlock(block: Block | null, blockResults: BlockResultsResponse): ParsedTransaction[] {
    const parsedTransactions: ParsedTransaction[] = [];

    // Get transaction results from blockResults - try all possible locations
    const txResults = (blockResults as any).results || 
                     (blockResults as any).txs_results || 
                     (blockResults as any).tx_results ||
                     (blockResults as any).deliverTx ||
                     (blockResults as any).deliver_tx ||
                     [];
    
    logger.debug(`TransactionParser: Block results has ${txResults.length} transaction results`);
    
    // Log the structure of blockResults for debugging
    if (typeof blockResults === 'object' && blockResults !== null) {      
      // Log which transaction fields are present
      const txFields = ['results', 'txs_results', 'tx_results', 'deliverTx', 'deliver_tx'];
      for (const field of txFields) {
        const value = (blockResults as any)[field];
        if (value !== undefined) {
          logger.debug(`TransactionParser: Found transaction field '${field}': type=${typeof value}, length=${Array.isArray(value) ? value.length : 'not array'}`);
        }
      }
    }
    
    // Also check for SEDA events in beginBlockEvents and endBlockEvents
    const beginBlockEvents = (blockResults as any).beginBlockEvents || [];
    const endBlockEvents = (blockResults as any).endBlockEvents || [];
    logger.debug(`TransactionParser: Block has ${beginBlockEvents.length} beginBlock events and ${endBlockEvents.length} endBlock events`);

    // Process transaction results
    for (let i = 0; i < txResults.length; i++) {
      try {
        logger.debug(`TransactionParser: Processing transaction result ${i}/${txResults.length}`);
        
        const txResult = txResults[i];
        
        // Log the structure of this transaction result
        if (txResult && typeof txResult === 'object') {
          const txKeys = Object.keys(txResult);
          logger.debug(`TransactionParser: Tx ${i} keys: ${txKeys.join(', ')}`);
        }
        
        const success = txResult?.code === 0;
        logger.debug(`TransactionParser: Tx ${i} result - success: ${success}, code: ${txResult?.code}`);
        
        // Log events structure
        const events = txResult.events || [];
        logger.debug(`TransactionParser: Tx ${i} has ${events.length} events`);
        if (events.length > 0) {
          const eventTypes = events.map((e: any) => e.type).slice(0, 5);
          logger.debug(`TransactionParser: Tx ${i} event types: ${eventTypes.join(', ')}`);
        }
        
        // Parse messages from transaction events
        const messages = this.parseMessagesFromEvents(events);
        logger.debug(`TransactionParser: Tx ${i} parsed ${messages.length} messages from events`);
        
        if (messages.length > 0) {
          const messageTypes = messages.map(m => m.typeUrl).slice(0, 3);
          logger.debug(`TransactionParser: Tx ${i} message types: ${messageTypes.join(', ')}`);
        }
        
        const parsedTx: ParsedTransaction = {
          hash: this.getTxHashFromEvents(events, i),
          success,
          messages
        };

        parsedTransactions.push(parsedTx);

        if (success && this.hasSedaMessages(messages)) {
          logger.info(`TransactionParser: Found SEDA transaction at index ${i}`);
        }
      } catch (error) {
        logger.warn(`TransactionParser: Failed to parse transaction result ${i}: ${error}`);
      }
    }

    // Process block-level events (beginBlock and endBlock) for SEDA events
    const blockLevelEvents = [...beginBlockEvents, ...endBlockEvents];
    if (blockLevelEvents.length > 0) {
      logger.debug(`TransactionParser: Processing ${blockLevelEvents.length} block-level events`);
      
      const blockMessages = this.parseMessagesFromEvents(blockLevelEvents);
      if (blockMessages.length > 0) {
        // Create a synthetic transaction for block-level SEDA events
        const blockTx: ParsedTransaction = {
          hash: `block_${blockResults.height}_events`,
          success: true, // Block-level events are always successful
          messages: blockMessages
        };
        
        parsedTransactions.push(blockTx);
        
        if (this.hasSedaMessages(blockMessages)) {
          logger.info(`TransactionParser: Found SEDA events in block-level events`);
        }
      }
    }

    logger.debug(`TransactionParser: Parsed ${parsedTransactions.length} transactions from ${txResults.length} transaction results + block events`);
    return parsedTransactions;
  }

  parseMessages(messages: any[]): ParsedMessage[] {
    const parsedMessages: ParsedMessage[] = [];

    for (const message of messages) {
      try {
        const parsedMessage: ParsedMessage = {
          typeUrl: message.typeUrl || '',
          value: message.value,
          sedaContext: this.extractSedaContext(message)
        };

        parsedMessages.push(parsedMessage);
      } catch (error) {
        logger.warn("Failed to parse message");
      }
    }

    return parsedMessages;
  }

  parseMessagesFromEvents(events: any[]): ParsedMessage[] {
    const parsedMessages: ParsedMessage[] = [];
    
    // First, find the most specific SEDA events to avoid duplicates
    const sedaEventTypes = new Set<string>();
    const specificSedaEvents = events.filter(event => {
      const eventType = event.type;
      // Prioritize specific SEDA events over generic ones
      if (eventType === 'wasm-seda-data-request' || 
          eventType === 'wasm-seda-commitment' || 
          eventType === 'wasm-seda-reveal') {
        sedaEventTypes.add(this.getSedaActionType(event));
        return true;
      }
      return false;
    });

    // Extract transaction-level context (like sender) from message events
    const txContext = this.extractTransactionContext(events);

    // Process all events, but skip generic wasm/execute events if we have specific SEDA events
    for (const event of events) {
      try {
        logger.debug(`TransactionParser: Processing event type: ${event.type}, attributes: ${event.attributes?.length || 0}`);
        
        // Log event details for debugging
        if (event.attributes && event.attributes.length > 0) {
          const attrSample = event.attributes.slice(0, 3).map((attr: any) => `${attr.key}=${attr.value}`).join(', ');
          logger.debug(`TransactionParser: Event ${event.type} sample attributes: ${attrSample}`);
        }
        
        // Skip generic events if we have specific SEDA events for the same action
        if (this.shouldSkipGenericEvent(event, sedaEventTypes)) {
          logger.debug(`TransactionParser: Skipping generic event ${event.type} - specific SEDA event exists`);
          continue;
        }
        
        // Extract message data from event attributes
        const message = this.extractMessageFromEvent(event);
        if (message) {
          const sedaContext = this.extractSedaContextFromEvent(event);
          
          // Enhance SEDA context with transaction-level information
          if (sedaContext && txContext.sender) {
            if (sedaContext.type === 'commit_data_result' && !sedaContext.publicKey) {
              sedaContext.publicKey = txContext.sender;
            }
            if (sedaContext.type === 'reveal_data_result' && !sedaContext.publicKey) {
              sedaContext.publicKey = txContext.sender;
            }
          }

          const parsedMessage: ParsedMessage = {
            typeUrl: message.typeUrl || event.type,
            value: message.value,
            sedaContext
          };

          parsedMessages.push(parsedMessage);
          logger.debug(`TransactionParser: Parsed message from event: ${event.type}`);
        }
      } catch (error) {
        logger.warn(`TransactionParser: Failed to parse event ${event.type}: ${error}`);
      }
    }

    return parsedMessages;
  }

  private extractSedaContext(message: any): SedaMessageContext | undefined {
    if (!message.typeUrl) return undefined;

    // Check for SEDA-specific message types based on typeUrl
    // All data extraction comes from message.value (transaction arguments), NOT events
    if (message.typeUrl.includes('post_data_request')) {
      return {
        type: 'post_data_request'
        // DR ID will be generated by DataRequestIdGenerator from message.value
      };
    }

    if (message.typeUrl.includes('commit_data_result')) {
      return {
        type: 'commit_data_result',
        // Extract from transaction arguments (message.value), NOT events
        commitmentHash: message.value?.commitment,
        publicKey: message.value?.public_key
      };
    }

    if (message.typeUrl.includes('reveal_data_result')) {
      return {
        type: 'reveal_data_result',
        // Extract from transaction arguments (message.value), NOT events  
        publicKey: message.value?.public_key
      };
    }

    return undefined;
  }

  private hasSedaMessages(messages: ParsedMessage[]): boolean {
    return messages.some(msg => msg.sedaContext !== undefined);
  }

  private getTxHash(txBase64: string): string {
    // For now, use a simple hash of the base64 string
    // In a real implementation, this would be the actual transaction hash
    const hash = Array.from(fromBase64(txBase64))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
      .substring(0, 64);
    
    return hash;
  }

  private getTxHashFromEvents(events: any[], index: number): string {
    // Look for transaction hash in events
    for (const event of events) {
      if (event.type === 'tx' || event.type === 'message') {
        for (const attr of event.attributes || []) {
          if (attr.key === 'tx.hash' || attr.key === 'hash') {
            return attr.value;
          }
        }
      }
    }
    
    // Fallback: generate a hash from event data
    const eventData = JSON.stringify(events);
    return `tx_${index}_${eventData.substring(0, 32)}`;
  }

  private extractMessageFromEvent(event: any): { typeUrl: string; value: any } | null {
    // Extract message information from event attributes
    const attributes: Record<string, any> = {};
    
    for (const attr of event.attributes || []) {
      attributes[attr.key] = attr.value;
    }

    // Check if this is a SEDA-related event
    if (this.isSedaEvent(event.type)) {
      return {
        typeUrl: event.type,
        value: attributes
      };
    }

    return null;
  }

  private extractSedaContextFromEvent(event: any): SedaMessageContext | undefined {
    const eventType = event.type;
    
    // Extract attributes into a map for easier access
    const attributes: Record<string, any> = {};
    for (const attr of event.attributes || []) {
      attributes[attr.key] = attr.value;
    }
    
    // Check for post_data_request patterns - prioritize specific SEDA events
    if (eventType === 'wasm-seda-data-request' ||
        eventType.includes('post_data_request') || 
        eventType === 'wasm-post_data_request' ||
        eventType.includes('seda.post_data_request') ||
        (eventType === 'wasm' && attributes.action === 'post_data_request')) {
      return {
        type: 'post_data_request'
        // DR ID will be generated by DataRequestIdGenerator from event attributes
      };
    }

    // Check for commit_data_result patterns - prioritize specific SEDA events
    if (eventType === 'wasm-seda-commitment' ||
        eventType.includes('commit_data_result') || 
        eventType === 'wasm-commit_data_result' ||
        eventType.includes('seda.commit_data_result') ||
        (eventType === 'wasm' && attributes.action === 'commit_data_result')) {
      return {
        type: 'commit_data_result',
        commitmentHash: attributes.commitment || attributes.commitment_hash,
        publicKey: attributes.public_key || attributes.pubkey
      };
    }

    // Check for reveal_data_result patterns - prioritize specific SEDA events
    if (eventType === 'wasm-seda-reveal' ||
        eventType.includes('reveal_data_result') || 
        eventType === 'wasm-reveal_data_result' ||
        eventType.includes('seda.reveal_data_result') ||
        (eventType === 'wasm' && attributes.action === 'reveal_data_result')) {
      return {
        type: 'reveal_data_result',
        publicKey: attributes.public_key || attributes.pubkey
      };
    }

    return undefined;
  }

  private isSedaEvent(eventType: string): boolean {
    // Check for specific SEDA event patterns only - avoid generic CosmWasm events
    const sedaPatterns = [
      'wasm-seda-data-request',    // Specific SEDA DR posting event
      'wasm-seda-commitment',      // Specific SEDA commitment event  
      'wasm-seda-reveal',          // Specific SEDA reveal event
      'post_data_request',
      'commit_data_result', 
      'reveal_data_result',
      'wasm-post_data_request',
      'wasm-commit_data_result',
      'wasm-reveal_data_result',
      'seda.post_data_request',
      'seda.commit_data_result',
      'seda.reveal_data_result'
    ];
    
    // Check for exact matches or specific SEDA patterns
    for (const pattern of sedaPatterns) {
      if (eventType === pattern || eventType.includes(pattern)) {
        return true;
      }
    }
    
    // Check for wasm events with SEDA actions (but only if they have SEDA-specific action)
    if (eventType === 'wasm') {
      // This will be checked in extractSedaContextFromEvent for action attribute
      return true;
    }
    
    return false;
  }

  private getSedaActionType(event: any): string {
    // Extract the SEDA action type from specific SEDA events
    if (event.type === 'wasm-seda-data-request') {
      return 'post_data_request';
    }
    if (event.type === 'wasm-seda-commitment') {
      return 'commit_data_result';
    }
    if (event.type === 'wasm-seda-reveal') {
      return 'reveal_data_result';
    }
    
    // For generic wasm events, check the action attribute
    const attributes: Record<string, any> = {};
    for (const attr of event.attributes || []) {
      attributes[attr.key] = attr.value;
    }
    
    return attributes.action || 'unknown';
  }

  private shouldSkipGenericEvent(event: any, specificSedaActionTypes: Set<string>): boolean {
    const eventType = event.type;
    
    // Skip generic wasm events if we have specific SEDA events for the same action
    if (eventType === 'wasm') {
      const attributes: Record<string, any> = {};
      for (const attr of event.attributes || []) {
        attributes[attr.key] = attr.value;
      }
      
      const action = attributes.action;
      if (action === 'post_data_request' && specificSedaActionTypes.has('post_data_request')) {
        return true;
      }
      if (action === 'commit_data_result' && specificSedaActionTypes.has('commit_data_result')) {
        return true;
      }
      if (action === 'reveal_data_result' && specificSedaActionTypes.has('reveal_data_result')) {
        return true;
      }
    }
    
    // Skip generic execute events if we have specific SEDA events
    if (eventType === 'execute' && specificSedaActionTypes.size > 0) {
      return true;
    }
    
    return false;
  }

  private extractTransactionContext(events: any[]): { sender?: string } {
    const context: { sender?: string } = {};
    
    // Look for sender information in message events
    for (const event of events) {
      if (event.type === 'message') {
        for (const attr of event.attributes || []) {
          if (attr.key === 'sender') {
            context.sender = attr.value;
            break;
          }
        }
        if (context.sender) break;
      }
    }
    
    return context;
  }

  extractDataRequestId(message: ParsedMessage): string | null {
    if (!message.sedaContext) return null;
    
    // For post_data_request messages, DR ID needs to be generated from arguments
    if (message.sedaContext.type === 'post_data_request') {
      return null; // Will be generated by DataRequestIdGenerator from message.value
    }

    // For commit/reveal messages, extract DR ID from message arguments
    if (message.sedaContext.type === 'commit_data_result' || 
        message.sedaContext.type === 'reveal_data_result') {
      // Extract from message.value (transaction arguments), NOT events
      if (!message.value || typeof message.value !== 'object') {
        return null;
      }
      return message.value.data_request_id || null;
    }

    return null;
  }

  extractDataRequestAttributes(message: ParsedMessage): any | null {
    if (!message.sedaContext) return null;
    
    if (!message.value || typeof message.value !== 'object') {
      return null;
    }

    // Extract all DR attributes from transaction arguments (message.value)
    switch (message.sedaContext.type) {
      case 'post_data_request':
        // Extract all arguments needed for DR ID generation and processing
        return {
          version: message.value?.version,
          exec_program_id: message.value?.exec_program_id,
          exec_inputs: message.value?.exec_inputs,
          exec_gas_limit: message.value?.exec_gas_limit,
          tally_program_id: message.value?.tally_program_id,
          tally_inputs: message.value?.tally_inputs,
          tally_gas_limit: message.value?.tally_gas_limit,
          replication_factor: message.value?.replication_factor,
          consensus_filter: message.value?.consensus_filter,
          gas_price: message.value?.gas_price,
          memo: message.value?.memo
        };

      case 'commit_data_result':
        // Extract commit-specific arguments
        return {
          data_request_id: message.value?.data_request_id,
          commitment: message.value?.commitment,
          public_key: message.value?.public_key
        };

      case 'reveal_data_result':
        // Extract reveal-specific arguments
        return {
          data_request_id: message.value?.data_request_id,
          public_key: message.value?.public_key,
          reveal_data: message.value?.reveal_data
        };

      default:
        return null;
    }
  }

  isSuccessfulTransaction(txResult: any): boolean {
    return txResult?.code === 0;
  }

  // Parse transactions and populate BlockEvent
  enhanceBlockEvent(blockEvent: BlockEvent): BlockEvent {
    const transactions = this.parseBlock(blockEvent.block, blockEvent.blockResults);
    
    return {
      ...blockEvent,
      transactions
    };
  }
} 