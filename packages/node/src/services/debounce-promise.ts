/**
 * A class that manages debounced promises, ensuring only one request goes through while multiple callers get the same response.
 * Different keys will create separate promises.
 */
export class DebouncedPromise<T> {
  private promises = new Map<string, Promise<T>>();

  /**
   * Executes the provided async function, ensuring only one request goes through for each key.
   * @param key The key to identify the promise group.
   * @param fn The async function to execute.
   * @returns A promise that resolves with the result of the async function.
   */
  async execute(key: string, fn: () => Promise<T>): Promise<T> {
    const existingPromise = this.promises.get(key);
    if (existingPromise) {
      return existingPromise;
    }

    const promise = fn().finally(() => {
      this.promises.delete(key);
    });

    this.promises.set(key, promise);
    return promise;
  }

  /**
   * Checks if there is an ongoing promise for the given key.
   * @param key The key to check.
   * @returns True if there is an ongoing promise for the key.
   */
  hasPromise(key: string): boolean {
    return this.promises.has(key);
  }

  /**
   * Clears all ongoing promises.
   */
  clear(): void {
    this.promises.clear();
  }
}
