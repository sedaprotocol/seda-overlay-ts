import { resolve } from "node:path";

const PLATFORM_TARGETS = [
	"bun-linux-x64",
	"bun-linux-arm64",
	"bun-windows-x64",
	"bun-darwin-x64",
	"bun-darwin-arm64",
	"bun-linux-x64-musl",
	"bun-linux-arm64-musl",
];

const DIST_FOLDER = resolve(import.meta.dir, "./build/");
const SRC_TARGET = resolve(import.meta.dir, "./packages/cli/src/index.ts");

for (const target of PLATFORM_TARGETS) {
	const rawTarget = target.replace("bun-", "");
	console.log(`Compiling for ${rawTarget}..`);
	const { exitCode, stdout, stderr } = Bun.spawnSync([
		"bun",
		"build",
		"--compile",
		`--target=${target}`,
		SRC_TARGET,
		"--outfile",
		resolve(DIST_FOLDER, `seda-overlay-${rawTarget}`),
	]);

	if (exitCode !== 0) {
		console.log(stdout.toString());
		console.error(stderr.toString());
	}

	console.log(`Compiled ${rawTarget}`);
}
