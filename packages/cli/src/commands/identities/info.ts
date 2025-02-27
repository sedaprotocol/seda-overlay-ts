import { Command } from "@commander-js/extra-typings";
import type { StakingConfig } from "@sedaprotocol/core-contract-schema";
import { formatTokenUnits } from "@sedaprotocol/overlay-ts-common";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { loadConfigAndSedaChain, populateWithCommonOptions } from "../../common-options";
import { getStakerAndSequenceInfo } from "../../services/get-staker-and-sequence-info";

interface TableEntry {
	identity: string;
	sequenceNumber: bigint;
	tokensStaked: string;
	tokensPendingWithdrawl: string;
	status: string;
}

export const info = populateWithCommonOptions(new Command("info"))
	.description("Prints the information about identity staking")
	.action(async (options) => {
		const { config, sedaChain } = await loadConfigAndSedaChain({
			config: options.config,
			mnemonic: options.mnemonic,
		});

		const stakingConfig = await sedaChain.queryContractSmart<StakingConfig>({
			get_staking_config: {},
		});

		if (stakingConfig.isErr) {
			logger.error(`Could not fetch staking config: ${stakingConfig.error}`);
			process.exit(1);
		}

		const entries: TableEntry[] = [];

		console.info("Loading..");

		for (const [index, identityId] of config.sedaChain.identityIds.entries()) {
			const response = await getStakerAndSequenceInfo(identityId, sedaChain);

			if (response.isErr) {
				logger.error(`Could not fetch info for ${identityId} (index: ${index}): ${response.error}`);
				continue;
			}

			response.value.staker.match({
				Just: (value) => {
					entries.push({
						identity: identityId,
						sequenceNumber: response.value.seq,
						tokensPendingWithdrawl: `${formatTokenUnits(value.tokens_pending_withdrawal)} SEDA`,
						tokensStaked: `${formatTokenUnits(value.tokens_staked)} SEDA`,
						status:
							BigInt(value.tokens_staked) >= BigInt(stakingConfig.value.minimum_stake_to_register)
								? "STAKED"
								: "NOT_ENOUGH_STAKE",
					});
				},
				Nothing: () => {
					entries.push({
						identity: identityId,
						sequenceNumber: response.value.seq,
						status: "NOT_REGISTERED",
						tokensPendingWithdrawl: "0.00 SEDA",
						tokensStaked: "0.00 SEDA",
					});
				},
			});
		}

		console.table(entries);
		process.exit(0);
	});
