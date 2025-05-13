import { rename } from "node:fs/promises";
import path, { resolve } from "node:path";
import { build } from "esbuild";
import { SeaEsbuildPlugin } from "sea-plugin";

console.log("Bundling code..");

const result = await Bun.build({
	entrypoints: [resolve(import.meta.dir, "./packages/cli/src/index.ts")],
	outdir: "./build",
	target: "node",
	format: "cjs",
});

const output = result.outputs[0];
await rename(output.path, resolve(import.meta.dir, "./build/seda-overlay.js"));

console.log("Bundled code");
console.log("Building binaries...");

// Common output folder
const outDir = path.resolve("build");

await build({
	entryPoints: ["./build/seda-overlay.js"],
	outfile: path.join(outDir, "bundle.cjs"),
	bundle: true,
	platform: "node",
	treeShaking: true,
	format: "cjs",
	banner: {
		js: `
      const import_meta_url = require('url').pathToFileURL(__filename);
    `,
	},
	define: {
		"import.meta.url": "import_meta_url",
	},
	plugins: [
		SeaEsbuildPlugin({
			name: "seda-overlay",
			nodeVersion: "23.9.0",
			os: ["linux-x64","linux-arm64"],
			assets: {},
		}),
	],
});

console.log("Built binaries");
