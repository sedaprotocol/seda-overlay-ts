import { resolve } from "node:path";

const PLATFORM_TARGETS = [
	"bun-linux-x64",
	"bun-linux-arm64",
	"bun-darwin-x64",
	"bun-darwin-arm64",
	"bun-linux-x64-musl",
	"bun-linux-arm64-musl",
	"bun-windows-x64",
];

const BUILD_FOLDER = resolve(import.meta.dir, "./build/");
const SRC_TARGET = [resolve(process.cwd(), "./packages/cli/src/index.ts")];

for (const target of PLATFORM_TARGETS) {
	const rawTarget = target.replace("bun-", "");
	console.log(`Compiling for ${rawTarget}..`);
	const cmd = [
		"bun",
		"build",
		"--compile",
		`--target=${target}`,
		...SRC_TARGET,
		"--outfile",
		`./seda-overlay-${rawTarget}`,
	];

	const { exitCode, stdout, stderr } = Bun.spawnSync(cmd, { cwd: Bun.env.TMPDIR });

	if (exitCode !== 0) {
		console.log(stdout.toString());
		console.error(stderr.toString());
	} else {
		// Copy the built binary to build directory
		const binaryName = `seda-overlay-${rawTarget}${rawTarget.includes("windows") ? ".exe" : ""}`;
		const tmpDir = Bun.env.TMPDIR ?? "/tmp";
		await Bun.write(resolve(BUILD_FOLDER, binaryName), Bun.file(resolve(tmpDir, binaryName)));
	}

	console.log(`Compiled ${rawTarget}`);
}
