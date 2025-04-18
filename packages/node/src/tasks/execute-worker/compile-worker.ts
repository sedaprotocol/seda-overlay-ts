import { type Worker, isMainThread, parentPort } from "node:worker_threads";
import { type VmCallData, createWasmModule } from "@seda-protocol/vm";

type CacheOptions = NonNullable<VmCallData["cache"]>;

if (!isMainThread) {
	let cacheOptions: CacheOptions | undefined = undefined;

	parentPort?.on("message", async (data: Uint8Array | CacheOptions) => {
		if (data instanceof Uint8Array) {
			const module = await createWasmModule(data, "exec", cacheOptions);

			parentPort?.postMessage(module);
		} else {
			cacheOptions = data;
		}
	});
}

export function compile(worker: Worker, binary: Uint8Array, cache: CacheOptions): Promise<WebAssembly.Module> {
	return new Promise((resolve) => {
		worker.postMessage(cache);
		worker.on("message", (module: WebAssembly.Module) => {
			resolve(module);
		});

		worker.postMessage(binary);
	});
}
