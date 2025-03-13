const STARTING_POINT = 9;
const REPLICATION_FACTOR = 100;

for (let i = STARTING_POINT; i < REPLICATION_FACTOR; i++) {
	Bun.spawnSync(["bun", "start-unchecked", "identities", "unstake", i.toString(), "1"], {
		stdout: "inherit",
		stderr: "inherit",
	});
}
