import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { PriorityQueueUnbounded } from "./priority-queue";

describe("PriorityQueue", () => {
	it("should take the highest priority item", async () => {
		const program = Effect.gen(function* () {
			const queue = yield* PriorityQueueUnbounded<number>();
			yield* queue.offer(1, 1);
			yield* queue.offer(2, 2);
			yield* queue.offer(3, 3);

			const result = yield* queue.take();
			const result2 = yield* queue.take();
			const result3 = yield* queue.take();

			expect(result).toBe(3);
			expect(result2).toBe(2);
			expect(result3).toBe(1);
		});

		await Effect.runPromise(program);
	});

	it("should take the highest priority item first and then the lower priority items", async () => {
		const program = Effect.gen(function* () {
			const queue = yield* PriorityQueueUnbounded<number>();
			yield* queue.offer(1, 0);
			yield* queue.offer(2, 0);
			yield* queue.offer(3, 1);
			yield* queue.offer(4, 0);

			const result = yield* queue.take();
			const result2 = yield* queue.take();
			const result3 = yield* queue.take();
			const result4 = yield* queue.take();

			expect(result).toBe(3);
			expect(result2).toBe(4);
			expect(result3).toBe(1);
			expect(result4).toBe(2);
		});

		await Effect.runPromise(program);
	});
});
