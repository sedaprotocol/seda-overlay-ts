import { rename } from "node:fs/promises";
import path, { resolve } from "node:path";
import { Command, Option } from "@commander-js/extra-typings";
import { build, type Plugin } from "esbuild";
import { SeaEsbuildPlugin } from "sea-plugin";

const cli = new Command().description("Builds the overlay node").addCommand(
	new Command("build").addOption(new Option("--with-binary").default(false)).action(async (options) => {
		console.log("Bundling code..");

		const result = await Bun.build({
			entrypoints: [resolve(import.meta.dir, "./packages/cli/src/index.ts")],
			outdir: "./build",
			target: "node",
			format: "cjs",
		});

		const output = result.outputs[0];
		await rename(output.path, resolve(import.meta.dir, "./build/seda-overlay.js"));

		console.log("Bundled code with Bun");

		// Common output folder
		const outDir = path.resolve("build");

		const plugins: Plugin[] = [];

		if (options.withBinary) {
			console.log("Will create binaries..");
			plugins.push(SeaEsbuildPlugin({
				name: "seda-overlay",
				nodeVersion: "23.9.0",
				os: ["linux-x64", "linux-arm64"],
				assets: {},
			}));
		}

		console.log("Building with esbuild..");

		await build({
			entryPoints: ["./build/seda-overlay.js"],
			outfile: path.join(outDir, "seda-overlay.cjs"),
			bundle: true,
			platform: "node",
			treeShaking: true,
			format: "cjs",
			banner: {
				js: `const import_meta_url = require('url').pathToFileURL(__filename);`,
			},
			define: {
				"import.meta.url": "import_meta_url",
			},
			plugins,
		});

		console.log("Built code with esbuild");
	}),
);

cli.parse(process.argv);