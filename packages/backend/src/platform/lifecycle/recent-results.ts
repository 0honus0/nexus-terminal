interface RecentResult<T> {
	value: T;
	expiresAt: number;
}

/** Completed results only. Active work must be tracked separately and never evicted. */
export class RecentResults<K, T> {
	private readonly entries = new Map<K, RecentResult<T>>();

	constructor(
		private readonly capacity: number,
		private readonly ttlMs: number,
	) {
		if (!Number.isSafeInteger(capacity) || capacity < 1 || !Number.isSafeInteger(ttlMs) || ttlMs < 1) {
			throw new Error('Invalid recent-result limits');
		}
	}

	get(key: K): T | undefined {
		this.prune();
		return this.entries.get(key)?.value;
	}

	set(key: K, value: T): void {
		this.prune();
		this.entries.delete(key);
		this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
		while (this.entries.size > this.capacity) {
			const oldest = this.entries.keys().next();
			if (oldest.done) {
				break;
			}
			this.entries.delete(oldest.value);
		}
	}

	private prune(): void {
		const now = Date.now();
		for (const [key, result] of this.entries) {
			if (result.expiresAt <= now) {
				this.entries.delete(key);
			}
		}
	}
}
