# SEDA Overlay TypeScript Implementation

## Installation

You can run the SEDA Overlay Node in one of two ways:

### Prebuilt Release

To run the overlay node we have two options:

1. **Prebuilt Binary** (Recommended)
   - Download the latest release from [GitHub Releases](https://github.com/sedaprotocol/seda-overlay-ts/releases)
   - Make it executable: `chmod +x seda-overlay`
   - Run directly from terminal

2. **Node.js Version** 
   - Download the `seda-overlay.js` file from [GitHub Releases](https://github.com/sedaprotocol/seda-overlay-ts/releases)
   - Run with Node.js: `node ./seda-overlay.js <command>`
   - Example commands:
     ```bash
     # Initialize the overlay node
     node ./seda-overlay.js init --network testnet

     # Run the overlay node
     node ./seda-overlay.js run --network testnet

     # Check identity status
     node ./seda-overlay.js identities info --network testnet
     ```

> **System Requirements:** The overlay node has been tested with Node.js v23.8.0. While it may work with other versions, we recommend using v23.8.0 or higher.

### Build from Source

**Requirements:**  
- [Bun](https://bun.sh/)
- [Git](https://git-scm.com/)

**Steps:**

1. Clone the repository:
   ```bash
   git clone https://github.com/sedaprotocol/seda-overlay-ts.git
   cd seda-overlay-ts
   ```
2. Install dependencies:
   ```bash
   bun install
   ```
3. Start the CLI:
   ```bash
   bun run start
   ```
4. (Optional) Build the project:
   ```bash
   bun run build
   ```

## Initializing the Configuration

To start using the overlay node, you must first initialize it. You can specify the network using the `--network` flag (defaults to `testnet` if not specified).

```bash
seda-overlay init --network <mainnet | testnet | devnet>

Initializing the overlay node..
Config file has been created at: /Users/myuser/.seda/testnet/config.jsonc
```

After initialization, a configuration file (`config.jsonc`) will be created in the `.seda` directory in your home folder:

```jsonc
{
    "sedaChain": {
        "rpc": "https://rpc.testnet.seda.xyz/",
        "chainId": "seda-1-testnet"
    }
}
```

### Environment variables

You must also provide an active mnemonic from the SEDA chain. This can be done through the `SEDA_MNEMONIC` environment variable. You can either supply this by prepending it to the command you're running `SEDA_MNEMONIC="YOUR_MNEMONIC_HERE" seda-overlay identities info` or by creating a `.env` file in the directory where the overlay is running.

For additional security this project uses https://dotenvx.com/, which allows you to encrypt your `.env` file. See the docs on how to set this up.

By default seda-overlay will check for a `.env` file in the working directory, but you can specify a different path through the `DOTENV_CONFIG_PATH` environment variable.

By default seda-overlay will check for a private key file at `$HOME/.dotenvx/overlay-ts.keys`, if there are no encrypted secrets in the `.env` file the secrets file does not need to be present. You can specify a different location through the `DOTENV_KEYS_PATH` environment variable.

## Identity Public Key

After initialization, you can already print your identity public key.

```bash
seda-overlay identities info --offline --network <mainnet | testnet | devnet>

Config file: /home/bun/.seda/testnet/config.jsonc
┌───┬────────────────────────────────────────────────────────────────────┐
│   │ Identity Public Key                                                │
├───┼────────────────────────────────────────────────────────────────────┤
│ 0 │ 020c4fe9e5063e7b5051284423089682082cf085a3b8f9e86bdb30407d761efc49 │
└───┴────────────────────────────────────────────────────────────────────┘
```

This prints your identity public keys without connecting to the network or requiring any tokens to be staked.

## Registering and Staking Your Overlay Node

Before running your overlay node, you must register your identity and stake SEDA tokens.

```bash
seda-overlay identities stake <SEDA_AMOUNT> --network <mainnet | testnet | devnet>
```

Parameters:
* `SEDA_AMOUNT` - The amount of SEDA tokens to stake on the network. Verify the required stake amount for your chosen network.

```bash
seda-overlay identities stake 32 --network devnet

2025-04-18 12:31:45.846 info: Identity 020c4fe9e5063e7b5051284423089682082cf085a3b8f9e86bdb30407d761efc49 already registered (staked: 0.00 SEDA, pending_withdrawal: 0.00 SEDA).
2025-04-18 12:31:45.849 info: Staking on identity 020c4fe9e5063e7b5051284423089682082cf085a3b8f9e86bdb30407d761efc49 with 32 SEDA (or 32000000000000000000 aSEDA)
2025-04-18 12:31:55.527 info: Successfully staked
```

## Running the Overlay Node

After registration and staking, you can start it using the `run` command to begin processing data requests:

```bash
seda-overlay run --network <mainnet | testnet | devnet>

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
seda-overlay identities info --network <mainnet | testnet | devnet>

Loading..
┌───┬────────────────────────────────────────────────────────────────────┬──────────┬───────────┬────────────────────┬────────┐
│   │ Identity                                                           │ Seq. No. │ Staked    │ Pending Withdrawal │ Status │
├───┼────────────────────────────────────────────────────────────────────┼──────────┼───────────┼────────────────────┼────────┤
│ 0 │ 020c4fe9e5063e7b5051284423089682082cf085a3b8f9e86bdb30407d761efc49 │ 2        │ 2.00 SEDA │ 0.12 SEDA          │ STAKED │
└───┴────────────────────────────────────────────────────────────────────┴──────────┴───────────┴────────────────────┴────────┘
```

This display shows the accrued rewards available for withdrawal ("Pending Withdrawal") for each identity. A basic setup will typically show only one identity (identity 0).

## Withdrawing Rewards

To withdraw all accumulated rewards, use the withdraw command:

```bash
seda-overlay identities withdraw --network <mainnet | testnet | devnet>
```

```bash
seda-overlay identities withdraw --network devnet

2025-04-18 12:50:18.271 info: Identity 020c4fe9e5063e7b5051284423089682082cf085a3b8f9e86bdb30407d761efc49 (staked: 2.00 SEDA, pending_withdrawal: 0.12 SEDA).
2025-04-18 12:50:18.332 info: Withdrawing 0.12 SEDA...
2025-04-18 12:50:26.323 info: Successfully withdrawn
```

Your fees have now been successfully withdrawn.

## Unstaking Your Overlay Node

To deactivate your node and retrieve your staked tokens, use the unstake command:

```bash
seda-overlay identities unstake --network <mainnet | testnet | devnet>
```

```bash
seda-overlay identities unstake --network devnet

2025-04-18 12:53:08.911 info: Identity 020c4fe9e5063e7b5051284423089682082cf085a3b8f9e86bdb30407d761efc49 (staked: 2.00 SEDA, pending_withdrawal: 0.00 SEDA).
2025-04-18 12:53:08.966 info: Unstaking 2.00 SEDA...
2025-04-18 12:53:11.462 info: Successfully unstaked
```

Verify the unstaking status using the `info` command:

```bash
seda-overlay identities info --network <mainnet | testnet | devnet>

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

You have now successfully unstaked your node and withdrawn your tokens.

## Validating your config

Validates your current configuration and outputs the complete configuration with all default values applied.
Safely redacts sensitive information like mnemonics and private keys from the output, making it safe to share for debugging or support purposes.

```bash
seda-overlay validate --network <mainnet | testnet | devnet>
```

This will output your configuration:

```bash
seda-overlay validate --network testnet

2025-07-07 10:45:22.112 info: Config: {
  "node": {
    "debug": false,
    "terminateAfterCompletion": false,
    "maxConcurrentRequests": 20,
    "maxGasLimit": "300000000000000",
    "maxVmLogsSizeBytes": 1024,

    ...
  },
  "httpServer": {
    "port": 3000,
    "enableAutoPortDiscovery": true
  },
  "wasmCacheDir": "/Users/seda/.seda/testnet/wasm_cache",
  "logsDir": "/Users/seda/.seda/testnet/logs",
  "workersDir": "/Users/seda/.seda/workers"
}
2025-07-07 10:45:22.114 info: Overlay configuration is valid ✅
```

You can also use the optional `--silent | -s` flag which just validates your configuration without any output:

```bash
seda-overlay validate --network testnet --silent
```


## Running with Docker

This project includes a Docker setup managed via a `Makefile` for easier environment management.

**Prerequisites:**
*   Docker and Docker Compose installed.
*   `make` installed.
*   Set required environment variables (e.g., in a `.env` file in the project root or export them in your shell):
    *   `TARGET_ARCH`: If you're running the project on a Mac, set the architecture to `bun-linux-arm64`
    *   `SEDA_MNEMONIC`: Your SEDA chain mnemonic (required).
    *   `SEDA_AMOUNT`: The amount of SEDA to stake (required for `make stake`).
    *   `SEDA_NETWORK`: The target network (optional, defaults to `testnet`).

**Workflow:**

1.  **Initialize:** Create the configuration directory and file.
    ```bash
    make init
    ```
    * Verify/edit the generated config in `./.seda/<network>/config.jsonc`. By default this should create a new folder for you in the `.build/docker/.seda/`, which initializes a new folder for each network.

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

