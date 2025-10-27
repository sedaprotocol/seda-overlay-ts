import { Command, Option } from "@commander-js/extra-typings";
import { MsgUnstake } from "@seda-protocol/proto-messages/libs/proto-messages/gen/sedachain/core/v1/tx";
import { createUnstakeMessageSignatureHash } from "@sedaprotocol/core-contract-schema";
import { TransactionPriority, formatTokenUnits, vrfProve } from "@sedaprotocol/overlay-ts-common";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { Maybe } from "true-myth";
import { loadConfigAndSedaChain, populateWithCommonOptions } from "../../common-options";
import { getStakerAndSequenceInfo } from "../../services/get-staker-and-sequence-info";

export const unstake = populateWithCommonOptions(new Command("unstake"))
	.description("Unstakes the entire stake from a certain identity")
	.addOption(new Option("--memo <string>", "memo to add to the transaction"))
	.addOption(new Option("-i, --identity-index <number>", "Identity index to use for unstaking").default(0))
	.action(async (options) => {
		const index = options.identityIndex;
		const { config, sedaChain } = await loadConfigAndSedaChain({
			config: options.config,
			mnemonic: options.mnemonic,
			network: options.network,
		});

		logger.info(`Using RPC: ${config.sedaChain.rpc}`);
		logger.info(`Using SEDA account ${sedaChain.getSignerAddress(0)}`);

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

		const staked = formatTokenUnits(staker.staked);
		const pendingWithdrawl = formatTokenUnits(staker.pendingWithdrawal);

		logger.info(`Identity ${identityId.value} (staked: ${staked} SEDA, pending_withdrawal: ${pendingWithdrawl} SEDA).`);

		const messageHash = createUnstakeMessageSignatureHash(config.sedaChain.chainId, stakerInfo.value.seq);

		const proof = vrfProve(privateKey.value, messageHash);
		logger.info(`Unstaking ${formatTokenUnits(staker.staked)} SEDA...`);

		const sender = sedaChain.getSignerAddress(0);
		const unstakeMsg = {
			typeUrl: "/sedachain.core.v1.MsgUnstake",
			value: MsgUnstake.fromPartial({
				sender: sender,
				publicKey: identityId.value,
				proof: proof.toString("hex"),
			}),
		};

		const response = await sedaChain.queueCosmosMessage(
			unstakeMsg,
			TransactionPriority.LOW,
			{ gas: "auto", adjustmentFactor: config.sedaChain.gasAdjustmentFactorCosmosMessages },
			0,
		);

		if (response.isErr) {
			logger.error(`Unstaking failed: ${response.error}`);
			process.exit(1);
		}

		logger.info("Successfully unstaked");
		process.exit(0);
	});
