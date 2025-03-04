import { createCommitmentHash } from "@sedaprotocol/core-contract-schema";
import { createRevealMessageSignatureHash } from "@sedaprotocol/core-contract-schema";
import { type SedaChain, waitForSmartContractTransaction } from "@sedaprotocol/overlay-ts-common";
import type { AlreadyRevealed, DataRequestExpired, RevealMismatch } from "@sedaprotocol/overlay-ts-common";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { Result, type Unit } from "true-myth";
import type { DataRequest } from "../models/data-request";
import type { ExecutionResult } from "../models/execution-result";
import type { IdentityPool } from "../models/identitiest-pool";

export class EnchancedRevealError {
	constructor(
		public error: RevealMismatch | AlreadyRevealed | DataRequestExpired | Error,
		public commitmentHash: Buffer,
	) {}
}

export async function revealDr(
	identityId: string,
	dataRequest: DataRequest,
	executionResult: ExecutionResult,
	identityPool: IdentityPool,
	sedaChain: SedaChain,
	appConfig: AppConfig,
): Promise<Result<Unit, EnchancedRevealError>> {
	const commitmentHash = createCommitmentHash(executionResult.revealBody);
	const messageHash = createRevealMessageSignatureHash(
		dataRequest.id,
		appConfig.sedaChain.chainId,
		await sedaChain.getCoreContractAddress(),
		dataRequest.height,
		commitmentHash,
	);

	const signature = identityPool.sign(identityId, messageHash);
	if (signature.isErr) return Result.err(new EnchancedRevealError(signature.error, commitmentHash));

	const revealResponse = await waitForSmartContractTransaction(sedaChain, {
		reveal_data_result: {
			dr_id: dataRequest.id,
			public_key: identityId,
			proof: signature.value.toString("hex"),
			reveal_body: {
				...executionResult.revealBody,
				gas_used: Number(executionResult.revealBody.gas_used.toString()),
				reveal: executionResult.revealBody.reveal.toString("base64"),
			},
			stderr: executionResult.stderr,
			stdout: executionResult.stdout,
		},
	});

	if (revealResponse.isErr) return Result.err(new EnchancedRevealError(revealResponse.error, commitmentHash));
	return Result.ok();
}
