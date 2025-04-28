# SEDA Overlay TypeScript Implementation

## Running the Overlay Node

To start using the overlay node, you must first initialize it. You can specify the network using the `--network` flag (defaults to `testnet` if not specified).

```bash
$ seda-overlay init --network <mainnet | testnet | devnet | planet>

Initializing the overlay node..
Config file has been created at: /Users/myuser/.seda/testnet/config.jsonc
Please fill in all properties (such as mnemonic)
```

After initialization, a configuration file (`config.jsonc`) will be created in the `.seda` directory in your home folder:

```jsonc
{
    "sedaChain": {
        "rpc": "https://rpc.testnet.seda.xyz/",
        "chainId": "seda-1-testnet",
        "mnemonic": "YOUR SEDA MNEMONIC HERE"
    }
}
```

You must provide an active mnemonic from the SEDA chain. Alternatively, you can set the `SEDA_MNEMONIC` environment variable.

Next, you'll need to register your identity. Use the identities command:

```bash
seda-overlay identities stake <SEDA_AMOUNT> --network <mainnet | testnet | devnet | planet>
```

Parameters:
* `SEDA_AMOUNT` - The amount of SEDA tokens to stake on the network. Verify the required stake amount for your chosen network.

```bash
seda-overlay identities stake 32 --network devnet

2025-04-18 12:31:45.846 info: Identity 020c4fe9e5063e7b5051284423089682082cf085a3b8f9e86bdb30407d761efc49 already registered (staked: 0.00 SEDA, pending_withdrawal: 0.00 SEDA).
2025-04-18 12:31:45.849 info: Staking on identity 020c4fe9e5063e7b5051284423089682082cf085a3b8f9e86bdb30407d761efc49 with 32 SEDA (or 32000000000000000000 aSEDA)
2025-04-18 12:31:55.527 info: Succesfully staked
```

Once your overlay node is registered, you can start it using the `run` command to begin processing data requests:

```bash
seda-overlay run --network <mainnet | testnet | devnet | planet>

2025-04-18 12:40:47.968 info: Node is starting..
2025-04-18 12:40:48.219 info: Using SEDA address: seda1uea9km4nup9q7qu96ak683kc67x9jf7ste45z5
2025-04-18 12:40:48.220 debug: Synchronous execution mode activated. Threads available: 10)
2025-04-18 12:40:48.314 info: [identity_020c4fe9e5063e7b5051284423089682082cf085a3b8f9e86bdb30407d761efc49] 🟢 Identity active - Stake requirement met
2025-04-18 12:40:49.318 info: 🔎 Looking for Data Requests...
2025-04-18 12:40:49.366 debug: Fetched 0 Data Requests in committing status (total: 0)
```

Your overlay node is now operational and ready to process data requests.

## Checking Your Identity Status

Monitor your node's identities using the info command:

```bash
seda-overlay identities info --network <mainnet | testnet | devnet | planet>

Loading..
┌───┬────────────────────────────────────────────────────────────────────┬──────────┬───────────┬────────────────────┬────────┐
│   │ Identity                                                           │ Seq. No. │ Staked    │ Pending Withdrawal │ Status │
├───┼────────────────────────────────────────────────────────────────────┼──────────┼───────────┼────────────────────┼────────┤
│ 0 │ 020c4fe9e5063e7b5051284423089682082cf085a3b8f9e86bdb30407d761efc49 │ 2        │ 2.00 SEDA │ 0.12 SEDA          │ STAKED │
└───┴────────────────────────────────────────────────────────────────────┴──────────┴───────────┴────────────────────┴────────┘
```

This display shows the accrued fees available for withdrawal ("Pending Withdrawal") for each identity. A basic setup will typically show only identity 0.

## Withdrawing Rewards

To withdraw all accumulated rewards, use the withdraw command:

```bash
seda-overlay identities withdraw --network <mainnet | testnet | devnet | planet>
```

```bash
seda-overlay identities withdraw --network devnet

2025-04-18 12:50:18.271 info: Identity 020c4fe9e5063e7b5051284423089682082cf085a3b8f9e86bdb30407d761efc49 (staked: 2.00 SEDA, pending_withdrawal: 0.12 SEDA).
2025-04-18 12:50:18.332 info: Withdrawing 0.12 SEDA...
2025-04-18 12:50:26.323 info: Succesfully withdrawn
```

Your fees have now been successfully withdrawn.

## Unstaking Your Overlay Node

To deactivate your node and retrieve your staked tokens, use the unstake command:

```bash
seda-overlay identities unstake --network <mainnet | testnet | devnet | planet>
```

```bash
seda-overlay identities unstake --network devnet

2025-04-18 12:53:08.911 info: Identity 020c4fe9e5063e7b5051284423089682082cf085a3b8f9e86bdb30407d761efc49 (staked: 2.00 SEDA, pending_withdrawal: 0.00 SEDA).
2025-04-18 12:53:08.966 info: Unstaking 2.00 SEDA...
2025-04-18 12:53:11.462 info: Succesfully unstaked
```

Verify the unstaking status using the `info` command:

```bash
seda-overlay identities info --network <mainnet | testnet | devnet | planet>

Loading..
┌───┬────────────────────────────────────────────────────────────────────┬──────────┬───────────┬────────────────────┬────────────┐
│   │ Identity                                                           │ Seq. No. │ Staked    │ Pending Withdrawal │ Status     │
├───┼────────────────────────────────────────────────────────────────────┼──────────┼───────────┼────────────────────┼────────────┤
│ 0 │ 020c4fe9e5063e7b5051284423089682082cf085a3b8f9e86bdb30407d761efc49 │ 4        │ 0.00 SEDA │ 2.00 SEDA          │ NOT_STAKED │
└───┴────────────────────────────────────────────────────────────────────┴──────────┴───────────┴────────────────────┴────────────┘
```

Finally, withdraw your stake using the withdraw command:

```bash
seda-overlay identities withdraw --network devnet
```

You have now successfully unstaked your node and withdrawn your stake.

## Running with Docker

This project includes a Docker setup managed via a `Makefile` for easier environment management.

**Prerequisites:**
*   Docker and Docker Compose installed.
*   `make` installed.
*   Set required environment variables (e.g., in a `.env` file in the project root or export them in your shell):
    *   `SEDA_MNEMONIC`: Your SEDA chain mnemonic (required).
    *   `SEDA_AMOUNT`: The amount of SEDA to stake (required for `make stake`).
    *   `SEDA_NETWORK`: The target network (optional, defaults to `testnet`).

**Workflow:**

1.  **Initialize:** Create the configuration directory and file.
    ```bash
    make init
    ```
    * Verify/edit the generated config in `./.seda/<network>/config.jsonc`. By default this should create a new folder for you in the `.build/docker/.seda/`, which initiates per network.

2.  **Stake:** Stake your SEDA tokens.
    ```bash
    make stake
    ```

3.  **Run:** Build the image (if needed) and start the overlay node container in the background.
    ```bash
    make run
    # Or build and run explicitly: make up
    ```

4.  **Check Logs:** Follow the container logs.
    ```bash
    make logs
    ```

5.  **Stop:** Stop and remove the container.
    ```bash
    make stop
    ```

**Other Commands:**

*   Check identity status: `make info`
*   Withdraw rewards: `make withdraw`
*   Unstake node: `make unstake`
*   Clean Docker resources: `make clean`
*   Access container shell: `make ssh`

