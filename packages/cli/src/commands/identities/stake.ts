import { Command, Option } from "@commander-js/extra-typings";
import { createStakeMessageSignatureHash } from "@sedaprotocol/core-contract-schema";
import { formatTokenUnits, parseTokenUnits, waitForSmartContractTransaction } from "@sedaprotocol/overlay-ts-common";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Maybe } from "true-myth";
import { prove } from "vrf-ts";
import { loadConfigAndSedaChain, populateWithCommonOptions } from "../../common-options";
import { getStakerAndSequenceInfo } from "../../services/get-staker-and-sequence-info";

export const stake = populateWithCommonOptions(new Command("stake"))
	.description("stakes on a certain identity")
	.argument("<number>", "Identity index to use for staking")
	.argument("<number>", "Amount to stake (a floating point number in `seda` units)")
	.addOption(new Option("--memo <string>", "memo to add to the transaction"))
	.action(async (index, amount, options) => {
		const memo = Maybe.of(options.memo).map((value) => Buffer.from(value));
		const attoSedaAmount = BigInt(parseTokenUnits(amount));

		const { config, sedaChain } = await loadConfigAndSedaChain({
			config: options.config,
			mnemonic: options.mnemonic,
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

		stakerInfo.value.staker.match({
			Just: (staker) => {
				const staked = formatTokenUnits(staker.tokens_staked);
				const pendingWithdrawl = formatTokenUnits(staker.tokens_pending_withdrawal);

				logger.info(
					`Identity ${identityId.value} already registered (staked: ${staked} SEDA, pending_withdrawal: ${pendingWithdrawl} SEDA).`,
				);
			},
			Nothing: () => {
				logger.info(`Registering new Identity (index "${index}") with stake ${amount} SEDA.`);
			},
		});

		const messageHash = createStakeMessageSignatureHash(
			config.sedaChain.chainId,
			coreContractAddress,
			stakerInfo.value.seq,
			memo,
		);

		logger.info(`Staking on identity ${identityId.value} with ${amount} SEDA (or ${attoSedaAmount} aSEDA)`);

		const proof = prove(privateKey.value, messageHash);
		const response = await waitForSmartContractTransaction(
			sedaChain,
			"stake",
			{
				stake: {
					public_key: identityId.value,
					proof: proof.toString("hex"),
					memo: memo.map((v) => v.toString("base64")).unwrapOr(null),
				},
			},
			attoSedaAmount,
			{ gas: "auto" },
		);

		if (response.isErr) {
			logger.error(`Staking failed: ${response.error}`);
			process.exit(1);
		}

		logger.info("Succesfully staked");
		process.exit(0);
	});
