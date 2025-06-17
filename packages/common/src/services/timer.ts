export function debouncedInterval<R = void>(callback: () => Promise<R>, interval: number): Timer {
	let processing = false;

	return setInterval(async () => {
		if (processing) return;
		processing = true;

		await callback();

		processing = false;
	}, interval);
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}
