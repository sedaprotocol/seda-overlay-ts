import { Keccak256, keccak256 } from "@cosmjs/crypto";
import { BN } from "bn.js";

interface DataRequest {
  version: string;
  execProgramId: string;
  execInputs: Buffer;
  tallyProgramId: string;
  tallyInputs: Buffer;
  replicationFactor: number;
  consensusFilter: Buffer;
  gasPrice: bigint;
  execGasLimit: bigint;
  tallyGasLimit: bigint;
  memo: Buffer;
  paybackAddress: Buffer;
}

export class DataRequestIdGenerator {
  /**
   * Generate DR ID from post_data_request message parameters
   * Based on reference implementation in solver-sdk
   */
  generateDrId(postDrMsg: {
    version: string;
    exec_program_id: string;
    exec_inputs: string; // base64 encoded
    exec_gas_limit: number;
    tally_program_id: string;
    tally_inputs: string; // base64 encoded
    tally_gas_limit: number;
    replication_factor: number;
    consensus_filter: string; // base64 encoded
    gas_price: string;
    memo: string; // base64 encoded
  }): string {
    // Convert from PostDataRequestArgs format to DataRequest format
    const dr: DataRequest = {
      version: postDrMsg.version,
      execProgramId: postDrMsg.exec_program_id,
      execInputs: Buffer.from(postDrMsg.exec_inputs, 'base64'),
      tallyProgramId: postDrMsg.tally_program_id,
      tallyInputs: Buffer.from(postDrMsg.tally_inputs, 'base64'),
      replicationFactor: postDrMsg.replication_factor,
      consensusFilter: Buffer.from(postDrMsg.consensus_filter, 'base64'),
      gasPrice: BigInt(postDrMsg.gas_price),
      execGasLimit: BigInt(postDrMsg.exec_gas_limit),
      tallyGasLimit: BigInt(postDrMsg.tally_gas_limit),
      memo: Buffer.from(postDrMsg.memo, 'base64'),
      paybackAddress: Buffer.alloc(0), // Not used in ID calculation
    };

    return this.createDataRequestId(dr);
  }

  /**
   * Core DR ID creation algorithm - matches solver SDK implementation
   */
  private createDataRequestId(dr: DataRequest): string {
    // Hash non-fixed-length inputs
    const drInputsHash = keccak256(dr.execInputs);
    const tallyInputsHash = keccak256(dr.tallyInputs);
    const consensusFilterHash = keccak256(dr.consensusFilter);
    const memoHash = keccak256(dr.memo);
    const versionHash = keccak256(Buffer.from(dr.version));

    // Convert fixed-length values to buffers with specific byte lengths
    const replicationFactor = new BN(dr.replicationFactor).toBuffer("be", 2); // 2 bytes for 16-bit
    const gasPrice = new BN(dr.gasPrice.toString()).toBuffer("be", 16); // 16 bytes for 128-bit
    const execGasLimit = new BN(dr.execGasLimit.toString()).toBuffer("be", 8); // 8 bytes for 64-bit
    const tallyGasLimit = new BN(dr.tallyGasLimit.toString()).toBuffer("be", 8); // 8 bytes for 64-bit

    // Hash the data request in the correct order
    const drHasher = new Keccak256();
    
    drHasher.update(versionHash);
    drHasher.update(Buffer.from(dr.execProgramId, "hex"));
    drHasher.update(drInputsHash);
    drHasher.update(execGasLimit);
    drHasher.update(Buffer.from(dr.tallyProgramId, "hex"));
    drHasher.update(tallyInputsHash);
    drHasher.update(tallyGasLimit);
    drHasher.update(replicationFactor);
    drHasher.update(consensusFilterHash);
    drHasher.update(gasPrice);
    drHasher.update(memoHash);

    return Buffer.from(drHasher.digest()).toString("hex");
  }
} 