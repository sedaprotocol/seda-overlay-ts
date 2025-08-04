import { type Command, Option } from "@commander-js/extra-typings";
import { DevTools } from "@effect/experimental";
import {
	SedaChain,
	type SedaChainService,
	SedaChainServiceLayer,
	startSedaChainService,
} from "@sedaprotocol/overlay-ts-common";
import { SigningClientService } from "@sedaprotocol/overlay-ts-common/src/seda/signing-client";
import { type AppConfig, loadConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Effect, type Layer } from "effect";
import { Maybe } from "true-myth";

export function populateWithCommonOptions(command: Command) {
	return command
		.addOption(new Option("-c, --config <string>", "Path to the config.json(c)").env("SEDA_CONFIG_PATH"))
		.addOption(new Option("--mnemonic <string>", "The mnemonic for the SEDA chain").env("SEDA_MNEMONIC"))
		.addOption(
			new Option("-n, --network <string>", "SEDA Chain network: 'mainnet', 'testnet', or 'devnet'")
				.env("SEDA_NETWORK")
				.default("testnet"),
		);
}

export async function loadConfigAndSedaChain(options: {
	config?: string;
	mnemonic: string | undefined;
	network: string;
}): Promise<{
	sedaChain: Layer.Layer<SedaChainService>;
	config: AppConfig;
}> {
	const config = await loadConfig(Maybe.of(options.config), options.network, Maybe.nothing(), {
		sedaChain: {
			mnemonic: options.mnemonic,
		},
	});

	if (config.isErr) {
		logger.error("Error while parsing config:");

		for (const error of config.error) {
			logger.error(error);
		}
		process.exit(1);
	}

	const sedaChain = await SedaChain.fromConfig(config.value, false);
	const sedaChainServiceLayer = await Effect.runPromise(
		SedaChainServiceLayer(config.value).pipe(
			Effect.provide(SigningClientService.Default()),
			Effect.provide(DevTools.layer()),
		),
	);

	if (sedaChain.isErr) {
		logger.error(`Could not create SEDA chain instance: ${sedaChain.error}`);
		process.exit(1);
	}

	sedaChain.value.start();
	await startSedaChainService(sedaChainServiceLayer);

	return {
		config: config.value,
		sedaChain: sedaChainServiceLayer,
	};
}
