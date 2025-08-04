# SEDA Overlay Node Configuration Options

This document describes all available configuration options for the SEDA Overlay Node. The configuration is stored in a JSON file located at `~/.seda/{network}/config.jsonc`.

## Configuration Structure

The configuration is organized into several sections:

- **Root Options**: Basic application settings
- **Node Configuration**: Core node behavior settings
- **SEDA Chain Configuration**: Blockchain connection and transaction settings
- **Intervals Configuration**: Task scheduling intervals
- **HTTP Server Configuration**: API server settings

## Root Options

| Option | Type | Required | Default | Description | Example |
|--------|------|----------|---------|-------------|---------|
| `$.homeDir` | `string` | No | `~/.seda/{network}/` | Custom home directory path | `"/custom/path/to/seda"` |

## Node Configuration

The `$.node` section controls the core behavior of the overlay node.

| Option | Type | Required | Default | Description | Example |
|--------|------|----------|---------|-------------|---------|
| `$.node.debug` | `boolean` | No | `false` | Enables debug mode for more verbose logging | `true` |
| `$.node.threadAmount` | `number` | No | - | Number of worker threads to use for processing | `4` |
| `$.node.terminateAfterCompletion` | `boolean` | No | `false` | Whether to terminate the node after completing all available data requests | `true` |
| `$.node.maxConcurrentRequests` | `number` | No | `20` | Maximum number of concurrent HTTP requests the node can make | `10` |
| `$.node.maxGasLimit` | `bigint` | No | `300_000_000_000_000` (300 Tgas) | Maximum gas limit for transactions | `"200000000000000"` |
| `$.node.maxVmLogsSizeBytes` | `number` | No | `1024` (1KB) | Maximum size of VM logs in bytes | `2048` |
| `$.node.processDrInterval` | `number` | No | `2500` (2.5 seconds) | Interval in milliseconds between data request processing cycles | `1000` |
| `$.node.blockLocalhost` | `boolean` | No | `true` | Whether to block requests to localhost addresses | `false` |
| `$.node.logLevel` | `"debug" \| "info" \| "warn" \| "error" \| "silly"` | No | `"info"` | Logging level for the application | `"debug"` |
| `$.node.logRotationEnabled` | `boolean` | No | `true` | Whether to enable log rotation | `false` |
| `$.node.logRotationLevel` | `"debug" \| "info" \| "warn" \| "error" \| "silly"` | No | `"debug"` | Logging level for rotated log files | `"info"` |
| `$.node.logRotationMaxFiles` | `string` | No | `"14d"` | Maximum number of log files to keep (supports time-based retention like "14d", "7d") | `"7d"` |
| `$.node.logRotationMaxSize` | `string` | No | `"10m"` | Maximum size of log files before rotation (supports units like "10m", "100m", "1g") | `"50m"` |
| `$.node.totalHttpTimeLimit` | `number` | No | `20000` (20 seconds) | Total time limit for HTTP requests in milliseconds | `30000` |
| `$.node.drFetchLimit` | `number` | No | `20` | Maximum number of data requests to fetch at once | `10` |
| `$.node.offlineEligibility` | `boolean` | No | `true` | Whether to check eligibility offline (without network connection) | `false` |
| `$.node.fetchFailureThreshold` | `number` | No | `0.2` (20%) | Threshold for considering fetch operations as failed (0.0 to 1.0) | `0.1` |
| `$.node.fetchCountRefreshInterval` | `number` | No | `300000` (5 minutes) | Interval in milliseconds to refresh fetch count statistics | `600000` |
| `$.node.gasEstimationsEnabled` | `boolean` | No | `true` | Whether to enable automatic gas estimation for transactions | `false` |

## SEDA Chain Configuration

The `$.sedaChain` section contains all blockchain-related settings.

| Option | Type | Required | Default | Description | Example |
|--------|------|----------|---------|-------------|---------|
| `$.sedaChain.rpc` | `string` | Yes | - | RPC endpoint URL for the SEDA blockchain | `"https://rpc.testnet.seda.xyz/"` |
| `$.sedaChain.mnemonic` | `string` | Yes | - | BIP39 mnemonic phrase for wallet generation | `"word1 word2 word3 ... word12"` |
| `$.sedaChain.accountAmounts` | `number` | No | `10` | Number of accounts to generate from the mnemonic | `5` |
| `$.sedaChain.minSedaPerAccount` | `bigint` | No | `1000000000000000000` (1 SEDA) | Minimum SEDA tokens required per account | `"500000000000000000"` |
| `$.sedaChain.chainId` | `string` | Yes | - | Chain ID for the SEDA network | `"seda-1-testnet"` |
| `$.sedaChain.contract` | `string` | No | `"auto"` | Contract address or "auto" for automatic detection | `"seda1..."` |
| `$.sedaChain.identitiesAmount` | `number` | No | `1` | Number of identities to generate for the node | `3` |
| `$.sedaChain.maxRetries` | `number` | No | `3` | Maximum number of retries for failed transactions | `5` |
| `$.sedaChain.sleepBetweenFailedTx` | `number` | No | `3000` (3 seconds) | Sleep time in milliseconds between failed transaction attempts | `5000` |
| `$.sedaChain.transactionPollInterval` | `number` | No | `2000` (2 seconds) | Interval in milliseconds to poll for transaction status | `1000` |
| `$.sedaChain.queueInterval` | `number` | No | `200` (0.2 seconds) | Interval in milliseconds between queue processing cycles | `100` |
| `$.sedaChain.gasPrice` | `string` | No | `"10000000000"` | Gas price in atto SEDA | `"5000000000"` |
| `$.sedaChain.gasAdjustmentFactor` | `number` | No | `1.1` | Gas adjustment factor for transaction estimation | `1.2` |
| `$.sedaChain.gasAdjustmentFactorCosmosMessages` | `number` | No | `2` | Gas adjustment factor specifically for Cosmos messages | `1.5` |
| `$.sedaChain.gas` | `number \| "auto"` | No | `"auto"` | Gas limit for transactions or "auto" for automatic estimation | `200000` |
| `$.sedaChain.memoSuffix` | `string` | No | `""` | Suffix to add to transaction memos | `" - My Node"` |
| `$.sedaChain.followHttpRedirects` | `boolean` | No | `true` | Whether to follow HTTP redirects | `false` |
| `$.sedaChain.httpRedirectTtlMs` | `number` | No | `300000` (5 minutes) | TTL for HTTP redirects in milliseconds | `600000` |
| `$.sedaChain.transactionBlockSearchThreshold` | `number` | No | `2` | Number of blocks to search for transactions before switching to direct lookup | `5` |
| `$.sedaChain.disableTransactionBlockSearch` | `boolean` | No | `true` | Whether to disable block-based transaction search | `false` |
| `$.sedaChain.rewardsWithdrawalInterval` | `number` | No | `86400000` (24 hours) | Interval in milliseconds for automatic rewards withdrawal | `3600000` (1 hour) |
| `$.sedaChain.rewardsWithdrawalMinimumThreshold` | `string` | No | `"1000000000000000000"` (1 SEDA) | Minimum amount of rewards required before withdrawal (in atto SEDA) | `"500000000000000000"` |
| `$.sedaChain.enableRewardsWithdrawal` | `boolean` | No | `false` | Whether to enable automatic rewards withdrawal | `true` |

## Intervals Configuration

The `$.intervals` section controls the timing of various background tasks.

| Option | Type | Required | Default | Description | Example |
|--------|------|----------|---------|-------------|---------|
| `$.intervals.fetchTask` | `number` | No | `1000` (1 second) | Interval in milliseconds for fetch task execution | `500` |
| `$.intervals.identityCheck` | `number` | No | `1200000` (20 minutes) | Interval in milliseconds for identity status checks | `600000` (10 minutes) |
| `$.intervals.statusCheck` | `number` | No | `2500` (2.5 seconds) | Interval in milliseconds for status checks | `1000` |
| `$.intervals.eligibilityCheck` | `number` | No | `3000` (3 seconds) | Interval in milliseconds for eligibility checks | `5000` |
| `$.intervals.drTask` | `number` | No | `100` (0.1 seconds) | Interval in milliseconds for data request task processing | `50` |

## HTTP Server Configuration

The `$.httpServer` section controls the built-in HTTP API server.

| Option | Type | Required | Default | Description | Example |
|--------|------|----------|---------|-------------|---------|
| `$.httpServer.port` | `number` | No | `3000` | Port number for the HTTP server | `8080` |
| `$.httpServer.enableAutoPortDiscovery` | `boolean` | No | `false` | Whether to automatically find an available port if the specified port is in use | `true` |

## Example Configuration

Here's a complete example configuration file:

```jsonc
{
  "homeDir": "/custom/seda/path",
  "node": {
    "debug": false,
    "threadAmount": 4,
    "terminateAfterCompletion": false,
    "maxConcurrentRequests": 20,
    "maxGasLimit": "300000000000000",
    "maxVmLogsSizeBytes": 1024,
    "processDrInterval": 2500,
    "blockLocalhost": true,
    "logLevel": "info",
    "logRotationEnabled": true,
    "logRotationLevel": "debug",
    "logRotationMaxFiles": "14d",
    "logRotationMaxSize": "10m",
    "totalHttpTimeLimit": 20000,
    "drFetchLimit": 20,
    "offlineEligibility": true,
    "fetchFailureThreshold": 0.2,
    "fetchCountRefreshInterval": 300000,
    "gasEstimationsEnabled": true
  },
  "sedaChain": {
    "rpc": "https://rpc.testnet.seda.xyz/",
    "chainId": "seda-1-testnet",
    "mnemonic": "your twelve word mnemonic phrase here",
    "accountAmounts": 10,
    "minSedaPerAccount": "1000000000000000000",
    "contract": "auto",
    "identitiesAmount": 1,
    "maxRetries": 3,
    "sleepBetweenFailedTx": 3000,
    "transactionPollInterval": 2000,
    "queueInterval": 200,
    "gasPrice": "10000000000",
    "gasAdjustmentFactor": 1.1,
    "gasAdjustmentFactorCosmosMessages": 2,
    "gas": "auto",
    "memoSuffix": "",
    "followHttpRedirects": true,
    "httpRedirectTtlMs": 300000,
    "transactionBlockSearchThreshold": 2,
    "disableTransactionBlockSearch": true,
    "rewardsWithdrawalInterval": 86400000,
    "rewardsWithdrawalMinimumThreshold": "1000000000000000000",
    "enableRewardsWithdrawal": false
  },
  "intervals": {
    "fetchTask": 1000,
    "identityCheck": 1200000,
    "statusCheck": 2500,
    "eligibilityCheck": 3000,
    "drTask": 100
  },
  "httpServer": {
    "port": 3000,
    "enableAutoPortDiscovery": false
  }
}
```

## Network-Specific Defaults

The overlay node provides default configurations for different networks:

### Devnet
- **RPC**: `https://rpc.devnet.seda.xyz/`
- **Chain ID**: `seda-1-devnet`

### Testnet
- **RPC**: `https://rpc.testnet.seda.xyz/`
- **Chain ID**: `seda-1-testnet`

### Mainnet
- **RPC**: `https://overlay-rpc.seda.xyz`
- **Chain ID**: `seda-1`

## Environment Variables

You can also set the `SEDA_MNEMONIC` environment variable instead of including the mnemonic in the configuration file:

```bash
export SEDA_MNEMONIC="your twelve word mnemonic phrase here"
```

## Notes

- All time intervals are specified in milliseconds
- Gas amounts are specified in atto SEDA (1 SEDA = 10^18 atto SEDA)
- The configuration file supports JSONC format, allowing comments
- Boolean values can be `true` or `false`
- BigInt values should be specified as strings to avoid precision issues
