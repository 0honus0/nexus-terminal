import { AsyncResource } from 'node:async_hooks';
import type { RunChangeKind, RunChangeScope } from './run-stream-types.js';

interface RunChangeListener {
	scope: RunChangeScope;
	changed(kind: RunChangeKind): void;
	stopped(): void;
	accepts?: (change: RunChangeScope) => boolean;
}

/** Invalidation only: the persistent source and its admission remain authoritative, including unknown commits. */
export class RunChanges {
	private readonly listeners = new Set<RunChangeListener>();
	private accepting = true;

	subscribe(
		scope: RunChangeScope,
		changed: (kind: RunChangeKind) => void,
		stopped: () => void,
		accepts?: (change: RunChangeScope) => boolean,
	): () => void {
		if (!this.accepting) {
			stopped();
			return () => {};
		}
		const listener: RunChangeListener = {
			scope: { userId: scope.userId, appId: scope.appId },
			// Event producers can hold temporary HTTP transaction admission. Run work
			// continues under the subscriber owner, never the publisher request.
			changed: AsyncResource.bind(changed),
			stopped: AsyncResource.bind(stopped),
			accepts,
		};
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	notify(scope: RunChangeScope, kind: RunChangeKind = 'state'): void {
		if (!this.accepting) {
			return;
		}
		const change: RunChangeScope = Object.freeze({
			userId: scope.userId,
			appId: scope.appId,
			runId: scope.runId,
			threadId: scope.threadId,
		});
		for (const listener of [...this.listeners]) {
			if (!this.listeners.has(listener)) {
				continue;
			}
			if (listener.scope.userId !== scope.userId || listener.scope.appId !== scope.appId) {
				continue;
			}
			try {
				if (
					(scope.runId === undefined && scope.threadId === undefined) ||
					!listener.accepts ||
					listener.accepts(change)
				) {
					listener.changed(kind);
				}
			} catch {
				// A failed consumer is disconnected and cannot prevent other owners becoming dirty.
				this.listeners.delete(listener);
				try {
					listener.stopped();
				} catch {
					/* Already detached from this producer. */
				}
			}
		}
	}

	async after<T>(scope: RunChangeScope, write: () => Promise<T>, kind: RunChangeKind = 'state'): Promise<T> {
		try {
			return await write();
		} finally {
			this.notify(scope, kind);
		}
	}

	quiesce(): void {
		if (!this.accepting) {
			return;
		}
		this.accepting = false;
		const current = [...this.listeners];
		this.listeners.clear();
		for (const listener of current) {
			try {
				listener.stopped();
			} catch {
				/* Other subscriptions still need their shutdown signal. */
			}
		}
	}

	close(): Promise<void> {
		this.quiesce();
		return Promise.resolve();
	}
}
