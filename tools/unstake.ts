const STARTING_POINT = 76;
const REPLICATION_FACTOR = 98;

for (let i = STARTING_POINT; i < REPLICATION_FACTOR; i++) {
	Bun.spawnSync(["bun", "start-unchecked", "identities", "unstake", i.toString(), "1"], {
		stdout: "inherit",
		stderr: "inherit",
	});
}
