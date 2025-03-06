import { Command, Option } from "@commander-js/extra-typings";
import { createWithdrawMessageSignatureHash } from "@sedaprotocol/core-contract-schema/src/identity";
import { formatTokenUnits, parseTokenUnits, vrfProve } from "@sedaprotocol/overlay-ts-common";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Maybe } from "true-myth";
import { loadConfigAndSedaChain, populateWithCommonOptions } from "../../common-options";
import { getStakerAndSequenceInfo } from "../../services/get-staker-and-sequence-info";

export const withdraw = populateWithCommonOptions(new Command("withdraw"))
	.description("Withdraws from a certain identity")
	.argument("<number>", "Identity index to use for staking")
	.argument("<number>", "Amount to stake (a floating point number in `seda` units)")
	.addOption(new Option("--memo <string>", "memo to add to the transaction"))
	.action(async (index, amount, options) => {
		const amountInAttoSeda = BigInt(parseTokenUnits(amount));
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
		if (BigInt(staker.tokens_pending_withdrawal) === 0n) {
			logger.error(`Cannot withdraw because identity has no pending withdraw (index ${index}).`);
			process.exit(1);
		}

		if (BigInt(staker.tokens_pending_withdrawal) < amountInAttoSeda) {
			logger.error(
				`Cannot withdraw because request amount to withdraw exceeds pending withdrawl (pending: ${pendingWithdrawl} SEDA or ${staker.tokens_pending_withdrawal} aSEDA, requested: ${amount} SEDA or ${amountInAttoSeda} aSEDA`,
			);
			process.exit(1);
		}

		const messageHash = createWithdrawMessageSignatureHash(
			amountInAttoSeda,
			config.sedaChain.chainId,
			coreContractAddress,
			stakerInfo.value.seq,
		);

		const proof = vrfProve(privateKey.value, messageHash);
		logger.info(`Withdrawing ${amount} SEDA..`);

		const response = await sedaChain.waitForSmartContractTransaction(
			{
				withdraw: {
					amount: amountInAttoSeda.toString(),
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

		logger.info("Succesfully withdrawn");
		process.exit(0);
	});
