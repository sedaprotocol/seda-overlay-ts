import { keccak256 } from "@sedaprotocol/overlay-ts-common";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import type { DataRequest } from "@sedaprotocol/overlay-ts-node";
import { createCacheId } from "@sedaprotocol/overlay-ts-node/src/tasks/execute";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const EXECUTION_BINARY_HASH = keccak256(Buffer.alloc(1)).toString('hex');

export async function createExecutionBinaryMock(appConfig: AppConfig) {
    const binary = await readFile(resolve(import.meta.dirname, "../res/chaos-dr.wasm"));

    writeFile(binary, `${appConfig.wasmCacheDir}${createCacheId(EXECUTION_BINARY_HASH)}`);
}

export async function createDataRequestMock(id: string) {

    const dataRequest: DataRequest = {
        id,
        version: "1",
        execProgramId: "1",
        commitsLength: 0,
        consensusFilter: Buffer.alloc(0),
        execGasLimit: BigInt(0),
        execInputs: Buffer.alloc(0),
        gasPrice: BigInt(0),
        height: BigInt(0),
        memo: Buffer.alloc(0),
        paybackAddress: Buffer.alloc(0),
        replicationFactor: 0,
        sedaPayload: Buffer.alloc(0),
        tallyGasLimit: BigInt(0),
        tallyInputs: Buffer.alloc(0),
        tallyProgramId: "1",
        lastUpdated: new Date(),
    };

    return dataRequest;
}