const STARTING_POINT = 0;
const REPLICATION_FACTOR = 10;

for (let i = STARTING_POINT; i < REPLICATION_FACTOR; i++) {
    Bun.spawnSync(["bun", "start-unchecked", "identities", "stake", i.toString(), "1"], {
        stdout: "inherit",
        stderr: "inherit"
    });
}