import { rename } from "node:fs/promises";
import { resolve } from "node:path";

console.log("Bundling code..");

const result = await Bun.build({
	entrypoints: [resolve(import.meta.dir, "./packages/cli/src/index.ts")],
	outdir: "./build",
	target: "node",
});

const output = result.outputs[0];
await rename(output.path, resolve(import.meta.dir, "./build/seda-overlay.js"));

console.log("Bundled code");
