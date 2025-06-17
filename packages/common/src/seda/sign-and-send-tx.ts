import type { IndexedTx } from "@cosmjs/cosmwasm-stargate";
import type { EncodeObject } from "@cosmjs/proto-signing";
import type { StdFee } from "@cosmjs/stargate";
import { context, trace } from "@opentelemetry/api";
import { tryAsync, trySync } from "@seda-protocol/utils";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Maybe, Result } from "true-myth";
import { IncorrectAccountSquence } from "./errors";
import type { GasOptions } from "./gas-options";
import type { SedaSigningCosmWasmClient } from "./signing-client";

export async function signAndSendTxSync(
	config: AppConfig["sedaChain"],
	signingClient: SedaSigningCosmWasmClient,
	address: string,
	messages: EncodeObject[],
	gasOptions: GasOptions = {},
	memo = "Sent from SEDA Overlay 🥟",
	traceId?: string,
): Promise<Result<string, IncorrectAccountSquence | Error>> {
	const tracer = trace.getTracer("seda-sign-and-send-tx");
	const parentSpan = tracer.startSpan("signAndSendTxSync", {
		attributes: {
			address,
			memo,
			traceId,
			messageCount: messages.length,
		},
	});

	const ctx = trace.setSpan(context.active(), parentSpan);
	const gasInput = gasOptions.gas ?? config.gas;
	let gas: bigint;

	if (gasInput === "auto") {
		const simulationSpan = tracer.startSpan("simulateGas", undefined, ctx);
		const simulatedGas = await tryAsync(async () => signingClient.simulate(address, messages, memo));
		if (simulatedGas.isErr) {
			logger.trace("Simulated gas failed for transaction", {
				id: traceId,
			});

			if (IncorrectAccountSquence.isError(simulatedGas.error)) {
				// Reset sequence number when we get a mismatch
				signingClient.accountInfo = Maybe.nothing();
				simulationSpan.recordException(simulatedGas.error);
				simulationSpan.end();
				parentSpan.recordException(simulatedGas.error);
				parentSpan.end();
				return Result.err(new IncorrectAccountSquence(simulatedGas.error.message));
			}

			simulationSpan.recordException(simulatedGas.error);
			simulationSpan.end();
			parentSpan.recordException(simulatedGas.error);
			parentSpan.end();
			return Result.err(simulatedGas.error);
		}

		const adjustmentFactor = gasOptions.adjustmentFactor ?? config.gasAdjustmentFactor;
		gas = BigInt(Math.round(simulatedGas.value * adjustmentFactor));
		simulationSpan.setAttribute("simulatedGas", gas.toString());
		simulationSpan.end();
	} else {
		const manualGas = trySync(() => BigInt(gasInput));
		if (manualGas.isErr) {
			parentSpan.recordException(manualGas.error);
			parentSpan.end();
			return Result.err(manualGas.error);
		}
		gas = manualGas.value;
	}

	const feeCalculationSpan = tracer.startSpan(
		"calculateFee",
		{
			attributes: {},
		},
		ctx,
	);
	const gasPrice = trySync(() => BigInt(gasOptions.gasPrice ?? config.gasPrice));
	if (gasPrice.isErr) {
		feeCalculationSpan.recordException(gasPrice.error);
		feeCalculationSpan.end();
		parentSpan.recordException(gasPrice.error);
		parentSpan.end();
		return Result.err(gasPrice.error);
	}

	const feeAmount = gas * gasPrice.value;
	const fee: StdFee = {
		gas: gas.toString(),
		amount: [{ denom: "aseda", amount: feeAmount.toString() }],
	};

	feeCalculationSpan.setAttributes({
		gas: gas.toString(),
		gasPrice: gasPrice.value.toString(),
		feeAmount: feeAmount.toString(),
	});
	feeCalculationSpan.end();

	logger.trace(`Using gas ${gas} with fee ${feeAmount} aseda`, {
		id: traceId,
	});

	const broadcastSpan = tracer.startSpan(
		"broadcastTransaction",
		{
			attributes: {},
		},
		ctx,
	);
	const txResult = await tryAsync(async () => signingClient.signAndBroadcastSync(address, messages, fee, memo));
	if (txResult.isErr) {
		if (IncorrectAccountSquence.isError(txResult.error)) {
			// Reset sequence number when we get a mismatch
			signingClient.accountInfo = Maybe.nothing();
			broadcastSpan.recordException(txResult.error);
			broadcastSpan.end();
			parentSpan.recordException(txResult.error);
			parentSpan.end();
			return Result.err(new IncorrectAccountSquence(txResult.error.message));
		}

		broadcastSpan.recordException(txResult.error);
		broadcastSpan.end();
		parentSpan.recordException(txResult.error);
		parentSpan.end();
		return Result.err(txResult.error);
	}

	broadcastSpan.setAttribute("transactionHash", txResult.value);
	broadcastSpan.end();
	parentSpan.end();
	return Result.ok(txResult.value);
}

export async function getTransaction(
	signingClient: SedaSigningCosmWasmClient,
	txHash: string,
): Promise<Result<Maybe<IndexedTx>, Error>> {
	const tracer = trace.getTracer("seda-get-transaction");
	const span = tracer.startSpan("getTransaction", {
		attributes: {
			txHash,
		},
	});

	const result = (await tryAsync(signingClient.getTx(txHash))).map((v) => Maybe.of(v));
	if (result.isErr) {
		span.end();
		return Result.err(result.error);
	}
	if (result.value.isNothing) {
		span.setAttribute("status", "not_found");
		span.end();
		return Result.ok(Maybe.nothing());
	}

	if (result.value.value.code !== 0) {
		span.setAttributes({
			status: "failed",
			errorCode: result.value.value.code,
			errorLog: result.value.value.rawLog,
		});
		span.end();
		return Result.err(new Error(`Transaction failed: ${result.value.value.rawLog}`));
	}

	span.setAttributes({
		status: "success",
		height: result.value.value.height,
		gasUsed: result.value.value.gasUsed.toString(),
		gasWanted: result.value.value.gasWanted.toString(),
	});
	span.end();
	return Result.ok(Maybe.just(result.value.value));
}
