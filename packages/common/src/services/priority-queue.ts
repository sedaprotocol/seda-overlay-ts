import { Effect, Queue } from "effect";

export interface PriorityQueueItem<T> {
	value: T;
	priority: number;
}

export interface PriorityQueue<T> {
	getHighestPriority: () => number;
	take: (condition?: (item: T) => boolean) => Effect.Effect<T>;
	offer: (value: T, priority?: number) => Effect.Effect<void>;
}

export const PriorityQueueUnbounded = <T>(): Effect.Effect<PriorityQueue<T>> =>
	Effect.gen(function* () {
		const priorityQueue = yield* Queue.unbounded<PriorityQueueItem<T>>();
		const priorities = new Map<number, number>(); // priority -> count

		const impl = {
			getHighestPriority: (): number => {
				let highestPriority = 0;

				for (const [priority, count] of priorities.entries()) {
					if (count > 0 && priority > highestPriority) {
						highestPriority = priority;
					}
				}

				return highestPriority;
			},
			take: (): Effect.Effect<T> =>
				Effect.gen(function* () {
					const item: PriorityQueueItem<T> = yield* priorityQueue.take;

					// Make sure this is the highest priority item
					// If not requeue the item and try again
					if (item.priority !== impl.getHighestPriority()) {
						yield* priorityQueue.offer(item);
						return yield* impl.take();
					}

					priorities.set(item.priority, (priorities.get(item.priority) ?? 0) - 1);

					return item.value;
				}),
			offer: (value: T, priority = 0) =>
				Effect.gen(function* () {
					priorities.set(priority, (priorities.get(priority) ?? 0) + 1);
					yield* priorityQueue.offer({ value, priority });
				}),
		};

		return impl;
	});
