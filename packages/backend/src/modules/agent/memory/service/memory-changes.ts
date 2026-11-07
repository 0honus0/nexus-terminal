import type { MemoryScope } from '../model/memory-types.js';

interface MemoryListener {
	scope: MemoryScope;
	changed: () => void;
	stopped: () => void;
}

/** App-scoped invalidation only. Consumers re-read facts through their own authority. */
export class MemoryChanges {
	private readonly listeners = new Set<MemoryListener>();

	subscribe(scope: MemoryScope & { threadId?: string }, changed: () => void, stopped: () => void): () => void {
		const listener = { scope: { userId: scope.userId, appId: scope.appId }, changed, stopped };
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	notify(scope: MemoryScope): void {
		for (const listener of [...this.listeners]) {
			if (
				!this.listeners.has(listener) ||
				listener.scope.userId !== scope.userId ||
				listener.scope.appId !== scope.appId
			) {
				continue;
			}
			try {
				listener.changed();
			} catch {
				this.listeners.delete(listener);
				try {
					listener.stopped();
				} catch {
					/* One consumer cannot stop other subscriptions. */
				}
			}
		}
	}
}
