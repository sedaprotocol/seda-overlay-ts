import { QueryClient, createProtobufRpcClient } from "@cosmjs/stargate";
import { Comet38Client } from "@cosmjs/tendermint-rpc";
import { sedachain } from "@seda-protocol/proto-messages";

export async function createProtoQueryClient(rpc: string) {
	const cometClient = await Comet38Client.connect(rpc);
	const queryClient = new QueryClient(cometClient);

	return createProtobufRpcClient(queryClient);
}

export async function createWasmQueryClient(rpc: string) {
	const protoRpcClient = await createProtoQueryClient(rpc);

	return new sedachain.wasm_storage.v1.QueryClientImpl(protoRpcClient);
}
