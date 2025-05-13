import type { SedaChain } from "@sedaprotocol/overlay-ts-common";
import { mock } from "bun:test";

export function createSedaChainMock() {
    // The mock function requires a function type, but SedaChain is an interface
    // Create a mock object that implements the SedaChain interface
    const sedaChain = mock(() => ({})) as unknown as SedaChain;

    return {
        sedaChain,
    };
}