import { resolve } from "node:path";

export function getEmbeddedVmWorkerCode(): string {
    const { stdout } = Bun.spawnSync(["bun", "build", resolve(import.meta.dir, "./execute-worker.ts"), "--target", "node"]);
    return stdout.toString();
}