import { resolve } from "node:path";

console.log("Bundling code..");

await Bun.build({
	entrypoints: [
        resolve(import.meta.dir, "./packages/cli/src/index.ts"),
        resolve(import.meta.dir, "./packages/node/src/tasks/execute-worker/compile-worker.ts"),
        resolve(import.meta.dir, "./packages/node/src/tasks/execute-worker/execute-worker.ts"),
    ],
	outdir: "./dist",
	target: "node",
});
