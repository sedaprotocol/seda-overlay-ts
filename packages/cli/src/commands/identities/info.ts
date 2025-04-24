import { Command } from "@commander-js/extra-typings";
import type { StakingConfig } from "@sedaprotocol/core-contract-schema";
import { formatTokenUnits } from "@sedaprotocol/overlay-ts-common";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { loadConfigAndSedaChain, populateWithCommonOptions } from "../../common-options";
import { getStakerAndSequenceInfo } from "../../services/get-staker-and-sequence-info";

interface TableEntry {
	identity: string;
	sequenceNumber: string;
	tokensStaked: string;
	tokensPendingWithdrawl: string;
	status: string;
}

export const info = populateWithCommonOptions(new Command("info"))
	.description("Prints the information about identity staking")
	.option("--offline", "Run in offline mode - only shows identity IDs without querying the chain")
	.action(async (options) => {
		const { config, sedaChain } = await loadConfigAndSedaChain({
			config: options.config,
			mnemonic: options.mnemonic,
			network: options.network,
		});

		if (options.offline) {
			const formattedEntries = config.sedaChain.identityIds.map((identityId) => ({
				"Identity Public Key": identityId,
			}));
			console.table(formattedEntries);
			process.exit(0);
			return;
		}

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
						sequenceNumber: response.value.seq.toString(),
						tokensPendingWithdrawl: `${formatTokenUnits(value.tokens_pending_withdrawal)} SEDA`,
						tokensStaked: `${formatTokenUnits(value.tokens_staked)} SEDA`,
						status: BigInt(value.tokens_staked) > BigInt(0) ? "STAKED" : "NOT_STAKED",
					});
				},
				Nothing: () => {
					entries.push({
						identity: identityId,
						sequenceNumber: response.value.seq.toString(),
						status: "NOT_REGISTERED",
						tokensPendingWithdrawl: "0.00 SEDA",
						tokensStaked: "0.00 SEDA",
					});
				},
			});
		}

		const formattedEntries = entries.map((entry) => ({
			Identity: entry.identity,
			"Seq. No.": entry.sequenceNumber,
			Staked: entry.tokensStaked,
			"Pending Withdrawal": entry.tokensPendingWithdrawl,
			Status: entry.status,
		}));
		console.table(formattedEntries);
		process.exit(0);
	});
