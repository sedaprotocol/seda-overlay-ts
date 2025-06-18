import { Command } from "@commander-js/extra-typings";
import { logger } from "@sedaprotocol/overlay-ts-logger";
import { getStakers } from "@sedaprotocol/overlay-ts-node/src/services/get-staker";
import { loadConfigAndSedaChain, populateWithCommonOptions } from "../../common-options";

export const availableExecutors = populateWithCommonOptions(new Command("available-executors"))
	.description("lists all available executors")
	.action(async (options) => {
		const { sedaChain } = await loadConfigAndSedaChain({
			config: options.config,
			mnemonic: options.mnemonic,
			network: options.network,
		});

		logger.info("Listing available executors..");

		const response = await getStakers(sedaChain);

		if (response.isErr) {
			logger.error(`Listing failed: ${response.error}`);
			process.exit(1);
		}

		const stakers = response.value.map((staker) => {
			const publicKey = staker.publicKey.toString("hex");
			return {
				publicKey,
				tokensStaked: staker.tokensStaked,
				tokensPendingWithdrawal: staker.tokensPendingWithdrawal,
				memo: staker.memo.unwrapOr(Buffer.alloc(0)).toString("utf-8"),
			};
		});

		console.table(stakers);

		logger.info("Succesfully listed available executors");
		process.exit(0);
	});
