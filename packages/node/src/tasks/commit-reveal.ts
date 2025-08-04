import { SedaChainService, TransactionPriority } from "@sedaprotocol/overlay-ts-common";
import type { GasOptions } from "@sedaprotocol/overlay-ts-common/src/seda/gas-options";
import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { Data, Effect, Option } from "effect";
import type { DataRequest } from "../models/data-request";
import type { ExecutionResult } from "../models/execution-result";
import type { IdentityPool } from "../models/identitiest-pool";
import { createCommitTransaction } from "./commit";
import { createRevealTransaction } from "./reveal";

export class ReplicationFactorError extends Data.TaggedError("ReplicationFactor")<{
	expectedReplicationFactor: number;
	actualReplicationFactor: number;
}> {
	message = `Replication factor must be ${this.expectedReplicationFactor}, but got ${this.actualReplicationFactor}`;
}

export function commitAndReveal(
	identityId: string,
	dataRequest: DataRequest,
	executionResult: ExecutionResult,
	identityPool: IdentityPool,
	appConfig: AppConfig,
) {
	return Effect.gen(function* () {
		const sedaChain = yield* SedaChainService;

		// Make sure the data request is replication factor 1
		if (dataRequest.replicationFactor !== 1) {
			return yield* Effect.fail(
				new ReplicationFactorError({
					expectedReplicationFactor: 1,
					actualReplicationFactor: dataRequest.replicationFactor,
				}),
			);
		}

		const commitTransaction = yield* createCommitTransaction(
			identityId,
			dataRequest,
			executionResult,
			identityPool,
			appConfig,
		);

		const revealTransaction = yield* createRevealTransaction(
			identityId,
			dataRequest,
			executionResult,
			identityPool,
			appConfig,
		);

		// Combine the commit and reveal gas options into a single gas option
		const gasOptions = Option.all({ commitGas: commitTransaction.gasOptions, revealGas: revealTransaction.gasOptions });

		// The gasOptions will always have the number, but to prevent regression errors we still check before combining
		const combinedGasOptions: Option.Option<GasOptions> = Option.match(gasOptions, {
			onNone: () => {
				return Option.none();
			},
			onSome: ({ commitGas, revealGas }) => {
				if (typeof commitGas.gas === "number" && typeof revealGas.gas === "number") {
					return Option.some({
						gas: commitGas.gas + revealGas.gas,
					});
				}

				return Option.none();
			},
		});

		yield* sedaChain.queueSmartContractMessage(
			`${dataRequest.id}_commit_reveal`,
			[commitTransaction.tx, revealTransaction.tx],
			TransactionPriority.HIGH,
			sedaChain.getSignerInfo(Option.none()),
			combinedGasOptions,
		);

		return {
			comittment: commitTransaction.commitment,
			revealBodyHash: revealTransaction.revealBodyHash,
		};
	});
}
