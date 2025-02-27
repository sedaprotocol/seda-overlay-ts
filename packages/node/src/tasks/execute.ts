import { callVm } from "@seda-protocol/vm";
import type { SedaChain } from "@sedaprotocol/overlay-ts-common";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { Result } from "true-myth";
import type { VmResult } from "../../../../../seda-sdk/dist/libs/vm/src/vm";
import type { DataRequest } from "../models/data-request";
import { OverlayVmAdapter } from "../overlay-vm-adapter";
import { getOracleProgram } from "../services/get-oracle-program";

interface VmResultOverlay extends VmResult {
	usedProxyPublicKeys: string[];
}

export function createVmResultError(error: Error): VmResultOverlay {
	return {
		exitCode: 1,
		stderr: error.message.toString(),
		stdout: "",
		result: new Uint8Array(),
		usedProxyPublicKeys: [],
		// TODO: This is not fully correct, the node did try to get the binary
		gasUsed: 0n,
	};
}

export async function executeDataRequest(
	identityPrivateKey: Buffer,
	dataRequest: DataRequest,
	appConfig: AppConfig,
	sedaChain: SedaChain,
): Promise<Result<VmResultOverlay, Error>> {
	const binary = await getOracleProgram(dataRequest.execProgramId, appConfig, sedaChain);

	if (binary.isErr) {
		return Result.err(new Error(`Could not load oracle program: ${binary.error}`));
	}

	if (binary.value.isNothing) {
		return Result.ok(createVmResultError(new Error(`Binary ${dataRequest.execProgramId} does not exist`)));
	}

	const drExecGasLimit = dataRequest.execGasLimit / BigInt(dataRequest.replicationFactor);
	// Clamp the gas limit to the maximum allowed by node config
	const clampedGasLimit = clampGasLimit(drExecGasLimit, appConfig.node.maxGasLimit);
	
	const vmAdapter = new OverlayVmAdapter(
		{
			chainId: appConfig.sedaChain.chainId,
			coreContractAddress: await sedaChain.getCoreContractAddress(),
			dataRequestId: dataRequest.id,
			gasPrice: dataRequest.gasPrice,
			identityPrivateKey,
		},
		sedaChain,
	);

	const result = await callVm(
		{
			args: [dataRequest.execInputs.toString("hex")],
			envs: {
				VM_MODE: "dr",
				DR_ID: dataRequest.id,
				EXEC_PROGRAM_ID: dataRequest.execProgramId,
				DR_REPLICATION_FACTOR: dataRequest.replicationFactor.toString(),
				DR_GAS_PRICE: dataRequest.gasPrice.toString(),
				DR_EXEC_GAS_LIMIT: clampedGasLimit.toString(),
				DR_TALLY_GAS_LIMIT: dataRequest.tallyGasLimit.toString(),
				DR_MEMO: dataRequest.memo.toString("hex"),
				DR_PAYBACK_ADDRESS: dataRequest.paybackAddress.toString("hex"),
				TALLY_PROGRAM_ID: dataRequest.tallyProgramId,
				TALLY_INPUTS: dataRequest.tallyInputs.toString("hex"),
			},
			binary: binary.value.value,
			gasLimit: clampedGasLimit,
		},
		undefined,
		vmAdapter,
	);

	// TODO: Check the max bytes of an execution result

	return Result.ok({
		...result,
		usedProxyPublicKeys: vmAdapter.usePublicKeys,
	});
}

/**
 * Clamps the gas limit to ensure it doesn't exceed the maximum allowed value
 * @param gasLimit The requested gas limit
 * @param maxGasLimit The maximum allowed gas limit from config
 * @returns The clamped gas limit
 */
function clampGasLimit(gasLimit: bigint, maxGasLimit: bigint): bigint {
	return gasLimit > maxGasLimit ? maxGasLimit : gasLimit;
}
