import { dependencies } from "../../package.json";

const debugVersion = `debug-${Math.random()}`;

export function getVmVersion(): string {
	const version = dependencies["@seda-protocol/vm"].replace("^", "");

	if (version.startsWith("file:")) {
		return debugVersion;
	}

	return version;
}
