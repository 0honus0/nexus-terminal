import type { RunChangeKind } from './run-stream-types.js';
import { EventEmitter } from 'node:events';

/** Wake committed text/state delivery; durable journals and existing admission remain authoritative. */
export class RunChanges {
	private readonly events = new EventEmitter();
	private accepting = true;

	constructor() {
		// Connections are owned and removed by their WS lifecycle, not a fixed listener quota.
		this.events.setMaxListeners(0);
	}

	subscribe(userId: number, appId: string, changed: (kind: RunChangeKind) => void, stopped: () => void): () => void {
		if (!this.accepting) {
			stopped();
			return () => {};
		}
		const key = `${userId}:${appId}`;
		this.events.on(key, changed);
		this.events.on('stop', stopped);
		return () => {
			this.events.off(key, changed);
			this.events.off('stop', stopped);
		};
	}

	async after<T>(userId: number, appId: string, write: () => Promise<T>, kind: RunChangeKind = 'state'): Promise<T> {
		try {
			return await write();
		} finally {
			// Even an unknown commit requires a read; this never retries the mutation.
			if (this.accepting) {
				this.events.emit(`${userId}:${appId}`, kind);
			}
		}
	}

	quiesce(): void {
		this.accepting = false;
		this.events.emit('stop');
		this.events.removeAllListeners();
	}

	close(): Promise<void> {
		this.quiesce();
		return Promise.resolve();
	}
}
