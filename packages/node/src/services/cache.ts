import { Maybe, Result } from "true-myth";

interface CacheEntry<T> {
	value: T;
	expiresAt: number;
}

/**
 * A generic in-memory cache implementation with TTL (Time To Live) support.
 * Cache entries automatically expire after the specified TTL duration.
 *
 * @template T The type of values stored in the cache. Must be an object type.
 */
export class Cache<T extends {}> {
	private cache: Map<string, CacheEntry<T>> = new Map();
	private inFlightRequests: Map<string, Promise<Result<T, Error>>> = new Map();

	/**
	 * Creates a new Cache instance.
	 * @param ttlMs Time To Live in milliseconds for cache entries
	 */
	constructor(private ttlMs: number) {}

	/**
	 * Stores a value in the cache with the specified key.
	 * The entry will expire after the TTL duration set in the constructor.
	 *
	 * @param key The key to store the value under
	 * @param value The value to cache
	 */
	set(key: string, value: T): void {
		this.cache.set(key, {
			value,
			expiresAt: Date.now() + this.ttlMs,
		});
		this.prune();
	}

	/**
	 * Retrieves a value from the cache.
	 * Returns Nothing if the key doesn't exist or if the entry has expired.
	 * Automatically removes expired entries when accessed.
	 *
	 * @param key The key to look up
	 * @returns A Maybe containing the cached value if it exists and hasn't expired
	 */
	get(key: string): Maybe<T> {
		const entry = this.cache.get(key);

		if (!entry) {
			return Maybe.nothing();
		}

		if (Date.now() > entry.expiresAt) {
			this.cache.delete(key);
			return Maybe.nothing();
		}

		this.prune();
		return Maybe.just<T>(entry.value);
	}

	/**
	 * Attempts to retrieve a value from the cache, falling back to fetching it
	 * from the provided fetch function if not found or expired.
	 * If the fetch is successful, the result is cached before being returned.
	 * Multiple concurrent calls with the same key will share the same fetch request.
	 *
	 * @param key The key to look up
	 * @param fetchFn A function that returns a Promise of a Result containing the value
	 * @returns A Promise of a Result containing either the cached/fetched value or an Error
	 */
	async getOrFetch(key: string, fetchFn: () => Promise<Result<T, Error>>): Promise<Result<T, Error>> {
		const cached = this.get(key);

		if (cached.isJust) {
			return Result.ok(cached.value);
		}

		// If there's already a request in flight for this key, return its promise
		const inFlight = this.inFlightRequests.get(key);
		if (inFlight) {
			return inFlight;
		}

		// Create new request and store it
		const fetchPromise = fetchFn().then((result) => {
			// Clean up the in-flight request
			this.inFlightRequests.delete(key);

			// Cache successful results
			if (result.isOk) {
				this.set(key, result.value);
			}

			return result;
		});

		this.inFlightRequests.set(key, fetchPromise);
		return fetchPromise;
	}

	/**
	 * Removes all entries from the cache.
	 */
	clear(): void {
		this.cache.clear();
	}

	/**
	 * Removes expired entries from the cache.
	 */
	private prune(): void {
		const now = Date.now();
		for (const [key, entry] of this.cache.entries()) {
			if (entry.expiresAt <= now) {
				this.cache.delete(key);
			}
		}
	}
}
