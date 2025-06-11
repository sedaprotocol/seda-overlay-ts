import fs from "node:fs/promises";
import { Argument, Command, Option } from "@commander-js/extra-typings";
import { tryAsync } from "@seda-protocol/utils";
import { type VmCallData, executeVm } from "@seda-protocol/vm";
import { SedaChain } from "@sedaprotocol/overlay-ts-common";
import { loadConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { OverlayVmAdapter } from "@sedaprotocol/overlay-ts-node/src/overlay-vm-adapter";
import { Maybe } from "true-myth";
import { populateWithCommonOptions } from "../../common-options";

export const executeOracleProgram = populateWithCommonOptions(new Command("execute-op"))
	.addArgument(new Argument("<binary_path>", "The path to the oracle program binary"))
	.addOption(
		new Option("--args <string>", "The arguments to pass to the oracle program").default("").conflicts("args-hex"),
	)
	.addOption(
		new Option("--args-hex <string>", "The arguments to pass to the oracle program as a hex string")
			.default("")
			.conflicts("args"),
	)
	.addOption(new Option("--gas-price <number>", "The gas price in attoSEDA for execution").default("2000"))
	.addOption(new Option("--gas-limit <number>", "The gas limit in teragas for execution").default("300"))
	.description("Executes an oracle program")
	.action(async (binaryPath, options) => {
		const config = await loadConfig(Maybe.of(options.config), options.network, Maybe.nothing(), {
			sedaChain: {
				mnemonic: options.mnemonic,
			},
		});

		if (!config.isOk) {
			logger.error("Error while parsing config:");

			for (const error of config.error) {
				logger.error(error);
			}
			process.exit(1);
		}

		const sedaChainRes = await SedaChain.fromConfig(config.value);
		if (sedaChainRes.isErr) {
			logger.error(`Failed to create SedaChain: ${sedaChainRes.error}`);
			process.exit(1);
		}

		const sedaChain = sedaChainRes.value;

		const binary = await tryAsync(fs.readFile(binaryPath));
		if (binary.isErr) {
			logger.error(`Failed to read binary: ${binary.error}`);
			process.exit(1);
		}

		const gasLimitTeraGas = Number(options.gasLimit);
		if (Number.isNaN(gasLimitTeraGas)) {
			logger.error(`Invalid gas limit: ${options.gasLimit}`);
			process.exit(1);
		}
		const gasLimit = BigInt(Math.floor(gasLimitTeraGas * 1_000_000_000_000));

		const gasPrice = Math.floor(Number(options.gasPrice));
		if (Number.isNaN(gasPrice)) {
			logger.error(`Invalid gas price: ${options.gasPrice}`);
			process.exit(1);
		}

		// The identity shouldn't matter for local execution
		const identityPrivateKey = config.value.sedaChain.identities.get(config.value.sedaChain.identityIds[0]);
		if (!identityPrivateKey) {
			logger.error(`Identity private key not found for identity ID: ${config.value.sedaChain.identityIds[0]}`);
			process.exit(1);
		}

		const vmAdapter = new OverlayVmAdapter(
			{
				chainId: config.value.sedaChain.chainId,
				coreContractAddress: await sedaChain.getCoreContractAddress(),
				dataRequestId: "0000000000000000000000000000000000000000000000000000000000000000",
				eligibilityHeight: 0n,
				gasPrice: BigInt(gasPrice),
				identityPrivateKey,
				appConfig: config.value,
				requestTimeout: config.value.node.requestTimeout,
				totalHttpTimeLimit: config.value.node.totalHttpTimeLimit,
			},
			sedaChain,
		);

		const callData: VmCallData = {
			args: [options.argsHex || Buffer.from(options.args, "utf-8").toString("hex")],
			vmMode: "exec",
			envs: {
				VM_MODE: "dr",
				DR_ID: "cli",
				DR_HEIGHT: "0",
				EXEC_PROGRAM_ID: "local",
				DR_REPLICATION_FACTOR: "1",
				DR_GAS_PRICE: "2000",
				DR_EXEC_GAS_LIMIT: gasLimit.toString(),
				DR_TALLY_GAS_LIMIT: "0",
				DR_MEMO: "",
				DR_PAYBACK_ADDRESS: "",
				TALLY_PROGRAM_ID: "local",
				TALLY_INPUTS: "",
			},
			binary: binary.value,
			gasLimit,
			stderrLimit: Number.POSITIVE_INFINITY,
			stdoutLimit: Number.POSITIVE_INFINITY,
		};

		logger.info("Executing oracle program...");
		const result = await executeVm(callData, "cli", vmAdapter);

		logger.info("Result:");
		console.dir(result);
	});
