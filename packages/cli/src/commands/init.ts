import { Command } from "@commander-js/extra-typings";
import { logger } from "@sedaprotocol/overlay-ts-logger";

export const init = new Command("init").description("Initializes the SEDA overlay node").action(async () => {
	logger.info("Creating the config and directories..");
});
