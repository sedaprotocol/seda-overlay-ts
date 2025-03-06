import type { AppConfig } from "@sedaprotocol/overlay-ts-config";
import { Maybe, Result } from "true-myth";
import { VRF } from "vrf-ts";

interface IdentityInfo {
	identityId: string;
	enabled: boolean;
	privateKey: Buffer;
}

export class IdentityPool {
	private pool: Map<IdentityInfo["identityId"], IdentityInfo>;

	constructor(private config: AppConfig) {
		const pool = new Map<IdentityInfo["identityId"], IdentityInfo>();

		for (const [identityId, privateKey] of config.sedaChain.identities.entries()) {
			pool.set(identityId, {
				enabled: false,
				identityId,
				privateKey,
			});
		}

		this.pool = pool;
	}

	sign(identityId: string, message: Buffer): Result<Buffer, Error> {
		return Maybe.of(this.config.sedaChain.identities.get(identityId)).match({
			Just: (secret) => {
				const vrf = new VRF("secp256k1");
				const proof = vrf.prove(secret, message);
				return Result.ok(proof);
			},
			Nothing() {
				return Result.err(new Error(`Could not find identity ${identityId}`));
			},
		});
	}

	setEnabledStatus(identityId: string, enabled: boolean) {
		this.getIdentityInfo(identityId).match({
			Just: (info) => {
				this.pool.set(identityId, {
					...info,
					enabled,
				});
			},
			Nothing: () => {},
		});
	}

	all() {
		return this.pool.values();
	}

	getIdentityInfo(identityId: string): Maybe<IdentityInfo> {
		return Maybe.of(this.pool.get(identityId));
	}

	isIdle() {
		return Array.from(this.pool.values()).every((identity) => !identity.enabled);
	}
}
