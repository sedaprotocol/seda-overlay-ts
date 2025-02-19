import { sedachain } from "@seda-protocol/proto-messages";
import { createProtoQueryClient } from "./query-client";

export async function createWasmStorageQueryClient(rpc: string) {
	const protoRpcClient = await createProtoQueryClient(rpc);
	return new sedachain.wasm_storage.v1.QueryClientImpl(protoRpcClient);
}
