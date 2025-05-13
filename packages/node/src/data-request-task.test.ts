import { describe, it, expect } from "bun:test";
import { createMockOverlayNode } from "@sedaprotocol/overlay-ts-test";
import { DataRequestTask } from "./data-request-task";
import { Maybe } from "true-myth";
import type { SedaChain } from "@sedaprotocol/overlay-ts-common";

describe("DataRequestTask", () => {
	it("should be a test", async () => {
        const mockNode = await createMockOverlayNode();

        const { dataRequest } = createDataRequestMock("1");
        const dataRequestTask = new DataRequestTask(
            mockNode.pool,
            mockNode.identityPool,
            mockNode.appConfig,
            mockNode.sedaChain as unknown as SedaChain,
            "1",
            "1",
            Maybe.nothing(),
            Maybe.nothing(),
            Maybe.nothing(),
        );

        // Simulate a tick
        await dataRequestTask.handleExecution();
        
        console.log('[DEBUG]: dataRequestTask ::: ', dataRequestTask);

		expect(true).toBe(true);
	});
});