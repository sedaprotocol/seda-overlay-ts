import { sha256 } from "@cosmjs/crypto";
import { toHex } from "@cosmjs/encoding";
import type { Block as BlockFromChain } from "@cosmjs/stargate";
import { tryAsync } from "@seda-protocol/utils";
import { type Layer, Option } from "effect";
import { Maybe, Result } from "true-myth";
import { Cache } from "../services/cache";
import { DebouncedPromise } from "../services/debounce-promise";
import type { SedaChain } from "./seda-chain";
import { type SedaChainService, getBlock as sedaChainGetBlock } from "./seda-chain-effect";

const BLOCK_HEIGHT_CACHE_TTL = 2500; // 2.5 seconds
const currentBlockHeightCache = new Cache<number>(BLOCK_HEIGHT_CACHE_TTL);
const CURRENT_BLOCK_HEIGHT_CACHE_KEY = "blockHeight";

// We omit the txs field because we don't need it and it's a large field
interface Block extends Omit<BlockFromChain, "txs"> {
	txIds: string[];
}

function transformBlock(block: BlockFromChain): Block {
	return {
		header: block.header,
		id: block.id,
		txIds: block.txs.map((tx) => toHex(sha256(tx)).toUpperCase()),
	};
}

export async function getCurrentBlockHeight(sedaChain: Layer.Layer<SedaChainService>): Promise<Result<number, Error>> {
	return currentBlockHeightCache.getOrFetch(CURRENT_BLOCK_HEIGHT_CACHE_KEY, async () => {
		const result = await sedaChainGetBlock(sedaChain, Option.none());

		if (result.isErr) {
			return Result.err(result.error);
		}

		// Cache so we safe a roundtrip
		blockCache.set(`block-${result.value.header.height}`, transformBlock(result.value));

		return Result.ok(result.value.header.height);
	});
}

const BLOCK_CACHE_TTL = 120_000; // 2 minutes
const blockCache = new Cache<Block>(BLOCK_CACHE_TTL);
const blockDebouncedPromise = new DebouncedPromise<Result<Maybe<BlockResult>, Error>>();

interface BlockResult {
	block: Block;
	// Indicates if the block is fully indexed. This is so that the caller can know if they need to wait for the block to be fully indexed.
	fullyIndexed: boolean;
}

export async function getBlock(sedaChain: SedaChain, height: number): Promise<Result<Maybe<BlockResult>, Error>> {
	const cacheKey = `block-${height}`;
	return blockDebouncedPromise.execute(cacheKey, async () => {
		const cachedValue = blockCache.get(cacheKey);

		// Blocks returned from cache are fully indexed
		if (cachedValue.isJust) {
			return Result.ok(
				Maybe.just({
					block: cachedValue.value,
					fullyIndexed: true,
				}),
			);
		}

		const result = await sedaChain.getBlock(height);

		if (result.isErr) {
			// Since we also get the current block height from the sedaChain, we can store and safe a roundtrip
			const heightErrorRegex = /height (\d+) must be less than or equal to the current blockchain height (\d+)/;
			const match = result.error.message.match(heightErrorRegex);

			if (match) {
				// Cache the current blockchain height
				currentBlockHeightCache.set(CURRENT_BLOCK_HEIGHT_CACHE_KEY, Number.parseInt(match[2]));
				return Result.ok(Maybe.nothing());
			}

			return Result.err(result.error);
		}

		const transactionsAmount = await getBlockTransactionsAmount(sedaChain, height);

		if (transactionsAmount.isErr) {
			return Result.err(transactionsAmount.error);
		}

		if (transactionsAmount.value.isNothing) {
			return Result.ok(Maybe.nothing());
		}

		if (transactionsAmount.value.value !== result.value.txs.length) {
			// Don't cache the block if it's not fully indexed
			return Result.ok(
				Maybe.just({
					block: transformBlock(result.value),
					fullyIndexed: false,
				}),
			);
		}

		// We cache the block if it's fully indexed
		blockCache.set(cacheKey, transformBlock(result.value));

		return Result.ok(
			Maybe.just({
				block: transformBlock(result.value),
				fullyIndexed: true,
			}),
		);
	});
}

interface BlockMeta {
	header: {
		height: string;
	};
	num_txs: string;
}

const BLOCK_METAS_CACHE_TTL = 120_000; // 2 minutes
const blockMetasCache = new Cache<number>(BLOCK_METAS_CACHE_TTL);
const blockMetasDebouncedPromise = new DebouncedPromise<Result<Maybe<number>, Error>>();

export async function getBlockTransactionsAmount(
	sedaChain: SedaChain,
	height: number,
): Promise<Result<Maybe<number>, Error>> {
	const cacheKey = `block-metas-${height}`;
	return blockMetasDebouncedPromise.execute(cacheKey, async () => {
		const cachedValue = blockMetasCache.get(cacheKey);

		if (cachedValue.isJust) {
			return Result.ok(Maybe.just(cachedValue.value));
		}

		const url = new URL(sedaChain.getRpcUrl());
		url.pathname = "/blockchain";
		url.searchParams.set("minHeight", height.toString());
		url.searchParams.set("maxHeight", height.toString());

		const blockchainResponse = await tryAsync(() => fetch(url.toString()));

		if (blockchainResponse.isErr) {
			return Result.err(blockchainResponse.error);
		}

		const blockchainData = await tryAsync(() => blockchainResponse.value.json());

		if (blockchainData.isErr) {
			return Result.err(blockchainData.error);
		}

		const blockMetas: BlockMeta[] = blockchainData.value?.result?.block_metas ?? [];
		const blockMeta = blockMetas.find((meta) => meta.header.height === height.toString());

		if (!blockMeta) {
			return Result.ok(Maybe.nothing());
		}

		blockMetasCache.set(cacheKey, Number.parseInt(blockMeta.num_txs));
		return Result.ok(Maybe.just(Number.parseInt(blockMeta.num_txs)));
	});
}
