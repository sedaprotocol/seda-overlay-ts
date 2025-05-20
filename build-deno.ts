import { resolve } from "node:path";
import { readableStreamToText } from "bun";

const PLATFORM_TARGETS = [
	// "x86_64-pc-windows-msvc",
	// "x86_64-apple-darwin",
	// "aarch64-apple-darwin",
	"x86_64-unknown-linux-gnu",
	// "aarch64-unknown-linux-gnu",
];

const BUILD_FOLDER = resolve(import.meta.dir, "./build/");
const SRC_TARGET = [resolve(process.cwd(), "./build/seda-overlay.cjs")];

await Promise.all(
	PLATFORM_TARGETS.map(async (target) => {
		const rawTarget = target.replace("bun-", "");
		console.log(`Compiling for ${rawTarget}..`);

		const cmd = [
			"deno",
			"compile",
			"-A",
			"--unstable-node-globals",
			"--no-check",
			"--target",
			target,
			"--no-remote",
			"--no-npm",
			"--output",
			`./build/deno-seda-overlay-${rawTarget}`,
			"--unstable-sloppy-imports",
			...SRC_TARGET,
		];

		console.log(cmd.join(" "));

		const tmpDir = Bun.env.TMPDIR ?? "/tmp";
		const result = Bun.spawn(cmd, { cwd: tmpDir, stdout: "pipe", stderr: "pipe" });
		const exitCode = await result.exited;

		if (exitCode !== 0) {
			console.error(
				`Compilation failed for ${rawTarget}: ${await readableStreamToText(result.stderr)} \n ${await readableStreamToText(result.stdout)}`,
			);
		} else {
			// Copy the built binary to build directory
			const binaryName = `seda-overlay-${rawTarget}${rawTarget.includes("windows") ? ".exe" : ""}`;
			await Bun.write(resolve(BUILD_FOLDER, binaryName), Bun.file(resolve(tmpDir, binaryName)));
		}

		console.log(`Compiled ${rawTarget}`);
	}),
);
