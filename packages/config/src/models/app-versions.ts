import overlayPackageJson from "../../../../package.json";
import nodePackageJson from "../../../node/package.json";

const debugVersion = `debug-${Math.random()}`;

export function getAppVersions() {
	let vmVersion = nodePackageJson.dependencies["@seda-protocol/vm"].replace("^", "");

	if (vmVersion.startsWith("file:")) {
		vmVersion = debugVersion;
	}

	return {
		vm: vmVersion,
		overlay: overlayPackageJson.version,
	};
}
