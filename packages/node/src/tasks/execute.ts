import { callVm } from "@seda-protocol/vm";
import type { SedaChain } from "@sedaprotocol/overlay-ts-common";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { Result } from "true-myth";
import type { DataRequest } from "../models/data-request";
import { getOracleProgram } from "../services/get-oracle-program";

type VmResult = Awaited<ReturnType<typeof callVm>>;

export function createVmResultError(error: Error): VmResult {
	return {
		exitCode: 1,
		stderr: error.message.toString(),
		stdout: "",
		result: new Uint8Array(),
	};
}

export async function executeDataRequest(
	dataRequest: DataRequest,
	appConfig: AppConfig,
	sedaChain: SedaChain,
): Promise<Result<VmResult, Error>> {
	const binary = await getOracleProgram(dataRequest.execProgramId, appConfig, sedaChain);

	if (binary.isErr) {
		return Result.err(new Error(`Could not load oracle program: ${binary.error}`));
	}

	if (binary.value.isNothing) {
		return Result.ok(createVmResultError(new Error(`Binary ${dataRequest.execProgramId} does not exist`)));
	}

	const result = await callVm({
		args: [dataRequest.execInputs.toString("hex")],
		envs: {},
		binary: binary.value.value,
	});

	return Result.ok(result);
}
