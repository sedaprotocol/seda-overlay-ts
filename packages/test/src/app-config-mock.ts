import { parseAppConfig, type AppConfig } from "@sedaprotocol/overlay-ts-config";
import { unwrap } from "true-myth/test-support";
import { Mnemonic } from "ethers";

const mockMnemonic = Mnemonic.fromEntropy(Buffer.alloc(32));

export async function createMockAppConfig(): Promise<AppConfig> {
    const config = await parseAppConfig({
        sedaChain: {
            rpc: "http://mock-rpc.test",
            mnemonic: mockMnemonic.phrase,
            chainId: "test-1"
        }
    }, "test");

    return unwrap(config);
}