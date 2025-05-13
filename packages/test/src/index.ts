import { DataRequestPool, IdentityPool } from "@sedaprotocol/overlay-ts-node";
import { createMockAppConfig } from "./app-config-mock";
import { createSedaChainMock } from "./seda-chain-mock";

export async function createMockOverlayNode() {
    const appConfig = await createMockAppConfig();
    const pool = new DataRequestPool();
    const identityPool = new IdentityPool(appConfig);
    const sedaChain = createSedaChainMock();

    return {
        pool,
        identityPool,
        appConfig,
        sedaChain,
    };
}

export * from "./data-request-mock";