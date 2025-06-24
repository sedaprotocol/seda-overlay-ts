// Keeps track of internal metrics for the node
// Global variables since it's easier to track them this way

import { match } from "ts-pattern";

class RpcMetrics {
    private totalRpcCalls = 0;

    // Data Request ID => RPC call with reason
    public dataRequestRpcCalls = new Map<string, string[]>();

    public incrementRpcCalls() {
        this.totalRpcCalls++;
    }

    public incrementDataRequestRpcCalls(drId: string, reason: string) {
        this.dataRequestRpcCalls.set(drId, [...(this.dataRequestRpcCalls.get(drId) || []), reason]);
        this.incrementRpcCalls();
    }

    public getTotalRpcCalls() {
        return this.totalRpcCalls;
    }

    public getDataRequestRpcCallsByDrId(drId: string) {
        return this.dataRequestRpcCalls.get(drId) || 0;
    }

    public getDataRequestRpcCalls() {
        return Array.from(this.dataRequestRpcCalls.entries()).map(([drId, reasons]) => ({
            drId,
            reasons,
            count: reasons.length,
        }));
    }
}

export const rpcMetrics = new RpcMetrics();

export function getRpcMetrics(rpcAggregation: "avg" | "all" = "avg") {
    const result = match(rpcAggregation)
        .with("all", () => {
            return {
                totalRpcCalls: rpcMetrics.getTotalRpcCalls(),
                dataRequestRpcCalls: rpcMetrics.getDataRequestRpcCalls(),
            };
        })
        .with("avg", () => {
            const dataRequestRpcCalls = rpcMetrics.getDataRequestRpcCalls();
            const totalRpcCalls = dataRequestRpcCalls.reduce((acc, curr) => acc + curr.count, 0);
            const avgRpcCalls = totalRpcCalls / dataRequestRpcCalls.length;

            return {
                totalRpcCalls: rpcMetrics.getTotalRpcCalls(),
                dataRequestRpcCalls: Number.isNaN(avgRpcCalls) ? 0 : avgRpcCalls,
            };
        }).exhaustive();

    return result;
}