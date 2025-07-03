import { logger } from "@sedaprotocol/overlay-ts-logger";

class ProtocolPauseState {
	private paused = false;

	public isPaused(): boolean {
		return this.paused;
	}

	public setPaused(paused: boolean): void {
		if (!this.paused && paused) {
			logger.warn("Protocol is paused, operation will be temporarily disabled");
		} else if (this.paused && !paused) {
			logger.info("Protocol is unpaused, operation will be re-enabled");
		}

		this.paused = paused;
	}
}

export const protocolPauseState = new ProtocolPauseState();
