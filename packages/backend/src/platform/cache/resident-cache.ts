import { LRUCache } from 'lru-cache';

export class ResidentCacheClosed extends Error {
	constructor() {
		super('Resident cache is closed');
	}
}

/** One owner, one retained snapshot. Invalidation replaces polling and expiry timers. */
export class ResidentCache<T> {
	private readonly cache: LRUCache<string, { value: T }>;
	private readonly loads = new Set<Promise<T>>();
	private generation = {};
	private accepting = true;
	private closePromise: Promise<void> | null = null;

	constructor(load: (signal: AbortSignal) => Promise<T>) {
		this.cache = new LRUCache({
			// This instance retains exactly one snapshot, including null/false results.
			max: 1,

			fetchMethod: async (_key, _previous, { signal }) => {
				const task = Promise.resolve().then(() => load(signal));
				this.loads.add(task);
				try {
					const value = await task;
					signal.throwIfAborted();
					return { value };
				} finally {
					this.loads.delete(task);
				}
			},
		});
	}

	async read(): Promise<T> {
		while (this.accepting) {
			const generation = this.generation;
			try {
				const result = await this.cache.fetch('snapshot');
				if (generation === this.generation && this.accepting && result !== undefined) {
					return result.value;
				}
			} catch (error) {
				// A replaced read joins the current generation; current failures are never cached.
				if (generation === this.generation && this.accepting) {
					throw error;
				}
			}
		}
		throw new ResidentCacheClosed();
	}

	invalidate(): void {
		this.generation = {};
		this.cache.clear();
	}

	quiesce(): void {
		this.accepting = false;
		this.invalidate();
	}

	close(): Promise<void> {
		if (this.closePromise === null) {
			// Save the owner Promise before abort listeners can re-enter close.
			this.closePromise = Promise.resolve().then(async () => {
				// A loader may ignore cancellation (for example an admitted SQLite read).
				await Promise.allSettled([...this.loads]);
			});
			this.quiesce();
		}
		return this.closePromise;
	}
}
