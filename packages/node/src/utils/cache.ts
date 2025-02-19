import { Maybe } from "true-myth";

type CacheEntry<T> = {
	data: T;
	timestamp: number;
};

export class Cache<T extends {}> {
	private cache: Map<string, CacheEntry<T>>;
	private readonly ttl: number; // Time-to-live in milliseconds

	constructor(ttl = 5_000) {
		this.cache = new Map();
		this.ttl = ttl;
	}

	private isExpired(entry: CacheEntry<T>): boolean {
		return Date.now() - entry.timestamp > this.ttl;
	}

	get(key: string): Maybe<T> {
		const entry = this.cache.get(key);
		if (entry && !this.isExpired(entry)) {
			return Maybe.just(entry.data);
		}
		this.cache.delete(key);
		return Maybe.nothing();
	}

	set(key: string, data: T): void {
		this.cache.set(key, { data, timestamp: Date.now() });
	}

	clear(): void {
		this.cache.clear();
	}
}
