export class SizedSet<T> extends Set<T> {
    constructor(private maxSize: number) {
        super();
    }

	add(item: T) {
		const added = super.add(item);

		if (this.size > this.maxSize) {
			const itemToRemove = this.values().next().value;
			if (itemToRemove) {
				this.delete(itemToRemove);
			}
		}

        return added;
	}
}