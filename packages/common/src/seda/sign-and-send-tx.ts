import type { IndexedTx } from "@cosmjs/cosmwasm-stargate";
import type { EncodeObject } from "@cosmjs/proto-signing";
import type { StdFee } from "@cosmjs/stargate";
import { tryAsync } from "@seda-protocol/utils";
import { Maybe, Result, ResultNS } from "true-myth";
import { DEFAULT_ADJUSTMENT_FACTOR, DEFAULT_GAS, DEFAULT_GAS_PRICE, type GasOptions } from "./gas-options";
import type { SedaSigningCosmWasmClient } from "./signing-client";

export async function signAndSendTxSync(
	signingClient: SedaSigningCosmWasmClient,
	address: string,
	messages: EncodeObject[],
	gasOptions: GasOptions = {},
	memo = "Sent from SEDA Overlay 🥟",
): Promise<Result<string, unknown>> {
	const gasInput = gasOptions.gas ?? DEFAULT_GAS;

	let gas: bigint;
	if (gasInput === "auto") {
		const simulatedGas = await tryAsync(async () => signingClient.simulate(address, messages, memo));
		if (simulatedGas.isErr) {
			return Result.err(simulatedGas.error);
		}

		const adjustmentFactor = gasOptions.adjustmentFactor ?? DEFAULT_ADJUSTMENT_FACTOR;
		gas = BigInt(Math.round(simulatedGas.value * adjustmentFactor));
	} else if (gasInput === "zero") {
		gas = 500000n;
	} else {
		const manualGas = ResultNS.tryOrElse(
			(e) => e,
			() => BigInt(gasInput),
		);
		if (manualGas.isErr) {
			return Result.err(manualGas.error);
		}
		gas = manualGas.value;
	}

	const gasPrice = ResultNS.tryOrElse(
		(e) => e,
		() => BigInt(gasOptions.gasPrice ?? DEFAULT_GAS_PRICE),
	);
	if (gasPrice.isErr) {
		return Result.err(gasPrice.error);
	}

	const feeAmount = gas * gasPrice.value;
	let fee: StdFee = {
		gas: gas.toString(),
		amount: [{ denom: "aseda", amount: feeAmount.toString() }],
	};

	if (gasInput === "zero") {
		fee = {
			...fee,
			amount: [],
		};
	}

	const txResult = await tryAsync(async () => signingClient.signAndBroadcastSync(address, messages, fee, memo));
	if (txResult.isErr) {
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
		console.log("[DEBUG]: result.value.value ::: ", result.value.value);
		return Result.err(new Error(`Transaction failed: ${result.value.value.rawLog}`));
	}

	return Result.ok(Maybe.just(result.value.value));
}
