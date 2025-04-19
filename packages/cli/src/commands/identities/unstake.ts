import { Command, Option } from "@commander-js/extra-typings";
import { createUnstakeMessageSignatureHash } from "@sedaprotocol/core-contract-schema";
import { formatTokenUnits, vrfProve } from "@sedaprotocol/overlay-ts-common";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Maybe } from "true-myth";
import { loadConfigAndSedaChain, populateWithCommonOptions } from "../../common-options";
import { getStakerAndSequenceInfo } from "../../services/get-staker-and-sequence-info";

export const unstake = populateWithCommonOptions(new Command("unstake"))
	.description("Unstakes the entire stake from a certain identity")
	.argument("<identity-index>", "Identity index to use for unstaking")
	.addOption(new Option("--memo <string>", "memo to add to the transaction"))
	.action(async (index, options) => {
		const { config, sedaChain } = await loadConfigAndSedaChain({
			config: options.config,
			mnemonic: options.mnemonic,
			network: options.network,
		});

		const identityId = Maybe.of(config.sedaChain.identityIds.at(Number(index)));

		if (identityId.isNothing) {
			logger.error(`Identity with index "${index}" does not exist`);
			process.exit(1);
		}

		const privateKey: Maybe<Buffer> = Maybe.of(config.sedaChain.identities.get(identityId.value));

		if (privateKey.isNothing) {
			logger.error(`Identity with index "${index}" does not exist`);
			process.exit(1);
		}

		const coreContractAddress = await sedaChain.getCoreContractAddress();
		const stakerInfo = await getStakerAndSequenceInfo(identityId.value, sedaChain);

		if (stakerInfo.isErr) {
			logger.error(`Could not fetch sequence: ${stakerInfo.error}`);
			process.exit(1);
		}

		if (stakerInfo.value.staker.isNothing) {
			logger.error(`Cannot unstake because identity is not registered (index ${index}).`);
			process.exit(1);
		}

		const staker = stakerInfo.value.staker.value;

		const staked = formatTokenUnits(staker.tokens_staked);
		const pendingWithdrawl = formatTokenUnits(staker.tokens_pending_withdrawal);

		logger.info(`Identity ${identityId.value} (staked: ${staked} SEDA, pending_withdrawal: ${pendingWithdrawl} SEDA).`);

		const messageHash = createUnstakeMessageSignatureHash(
			config.sedaChain.chainId,
			coreContractAddress,
			stakerInfo.value.seq,
		);

		const proof = vrfProve(privateKey.value, messageHash);
		logger.info(`Unstaking ${formatTokenUnits(staker.tokens_staked)} SEDA...`);
		const response = await sedaChain.waitForSmartContractTransaction(
			{
				unstake: {
					proof: proof.toString("hex"),
					public_key: identityId.value,
				},
			},
			undefined,
			{ gas: "auto" },
		);

		if (response.isErr) {
			logger.error(`Unstaking failed: ${response.error}`);
			process.exit(1);
		}

		logger.info("Succesfully unstaked");
		process.exit(0);
	});
