import { dependencies } from "../../package.json";

export function getVmVersion(): string {
	return dependencies["@seda-protocol/vm"].replace("^", "");
}
