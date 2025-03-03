import { createCommitmentHash, createCommitmentMessageSignatureHash } from "@sedaprotocol/core-contract-schema";
import { type SedaChain, waitForSmartContractTransaction } from "@sedaprotocol/overlay-ts-common";
import type { AlreadyCommitted, DataRequestExpired } from "@sedaprotocol/overlay-ts-common";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { Result } from "true-myth";
import type { DataRequest } from "../models/data-request";
import type { ExecutionResult } from "../models/execution-result";
import type { IdentityPool } from "../models/identitiest-pool";

export async function commitDr(
	identityId: string,
	dataRequest: DataRequest,
	executionResult: ExecutionResult,
	identityPool: IdentityPool,
	sedaChain: SedaChain,
	appConfig: AppConfig,
): Promise<Result<Buffer, DataRequestExpired | AlreadyCommitted | Error>> {
	const txKey = `${identityId}_${dataRequest.id}_commit`;
	const commitmentHash = createCommitmentHash(executionResult.revealBody);

	const messageHash = createCommitmentMessageSignatureHash(
		dataRequest.id,
		dataRequest.height,
		commitmentHash.toString("hex"),
		appConfig.sedaChain.chainId,
		await sedaChain.getCoreContractAddress(),
	);

	const signature = identityPool.sign(identityId, messageHash);
	if (signature.isErr) return Result.err(signature.error);

	const commitResponse = await waitForSmartContractTransaction(sedaChain, txKey, {
		commit_data_result: {
			dr_id: dataRequest.id,
			commitment: commitmentHash.toString("hex"),
			proof: signature.value.toString("hex"),
			public_key: identityId,
		},
	});

	if (commitResponse.isErr) {
		// TODO: Handle all different types of errors (already committed, in reveal stage etc)
		return Result.err(commitResponse.error);
	}

	return Result.ok(commitmentHash);
}
