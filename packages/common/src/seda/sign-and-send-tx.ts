import type { IndexedTx } from "@cosmjs/cosmwasm-stargate";
import type { EncodeObject } from "@cosmjs/proto-signing";
import type { StdFee } from "@cosmjs/stargate";
import { tryAsync, trySync } from "@seda-protocol/utils";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { Maybe, Result } from "true-myth";
import { IncorrectAccountSquence } from "./errors";
import type { GasOptions } from "./gas-options";
import type { SedaSigningCosmWasmClient } from "./signing-client";
import { logger } from "@sedaprotocol/overlay-ts-logger";

export async function signAndSendTxSync(
	config: AppConfig["sedaChain"],
	signingClient: SedaSigningCosmWasmClient,
	address: string,
	messages: EncodeObject[],
	gasOptions: GasOptions = {},
	memo = "Sent from SEDA Overlay 🥟",
	traceId?: string,
): Promise<Result<string, IncorrectAccountSquence | Error>> {
	const gasInput = gasOptions.gas ?? config.gas;

	let gas: bigint;
	if (gasInput === "auto") {
		const simulatedGas = await tryAsync(async () => signingClient.simulate(address, messages, memo));
		if (simulatedGas.isErr) {
			logger.trace("Simulated gas failed for transaction", {
				id: traceId,
			});

			if (IncorrectAccountSquence.isError(simulatedGas.error)) {
				// Reset sequence number when we get a mismatch
				signingClient.accountInfo = Maybe.nothing();
				return Result.err(new IncorrectAccountSquence(simulatedGas.error.message));
			}

			return Result.err(simulatedGas.error);
		}

		const adjustmentFactor = gasOptions.adjustmentFactor ?? config.gasAdjustmentFactor;
		gas = BigInt(Math.round(simulatedGas.value * adjustmentFactor));
	} else {
		const manualGas = trySync(() => BigInt(gasInput));
		if (manualGas.isErr) {
			return Result.err(manualGas.error);
		}
		gas = manualGas.value;
	}

	const gasPrice = trySync(() => BigInt(gasOptions.gasPrice ?? config.gasPrice));
	if (gasPrice.isErr) {
		return Result.err(gasPrice.error);
	}

	const feeAmount = gas * gasPrice.value;
	const fee: StdFee = {
		gas: gas.toString(),
		amount: [{ denom: "aseda", amount: feeAmount.toString() }],
	};

	logger.trace(`Using gas ${gas} with fee ${feeAmount} aseda`, {
		id: traceId,
	});

	const txResult = await tryAsync(async () => signingClient.signAndBroadcastSync(address, messages, fee, memo));
	if (txResult.isErr) {
		if (IncorrectAccountSquence.isError(txResult.error)) {
			// Reset sequence number when we get a mismatch
			signingClient.accountInfo = Maybe.nothing();
			return Result.err(new IncorrectAccountSquence(txResult.error.message));
		}

		return Result.err(txResult.error);
	}

	return Result.ok(txResult.value);
}

export async function getTransaction(
	signingClient: SedaSigningCosmWasmClient,
	txHash: string,
): Promise<Result<Maybe<IndexedTx>, Error>> {
	const result = (await tryAsync(signingClient.getTx(txHash))).map((v) => Maybe.of(v));
	if (result.isErr) return Result.err(result.error);
	if (result.value.isNothing) return Result.ok(Maybe.nothing());

	if (result.value.value.code !== 0) {
		return Result.err(new Error(`Transaction failed: ${result.value.value.rawLog}`));
	}

	return Result.ok(Maybe.just(result.value.value));
}
