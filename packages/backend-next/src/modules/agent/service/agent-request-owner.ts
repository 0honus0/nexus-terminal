import { AgentFailure } from '../agent-failure.js';

interface AgentResource {
	quiesce(): void;
	close(): Promise<void>;
}

/** Own all module requests, including Provider writes and detached Registry refresh drainage. */
export class AgentRequestOwner {
	private readonly pending = new Set<Promise<unknown>>();
	private closing = false;
	private closePromise: Promise<void> | null = null;
	private readonly maximumRequests = 64;
	private readonly stopFailures: unknown[] = [];

	constructor(private readonly resources: readonly AgentResource[]) {}

	async run<T>(work: () => Promise<T>): Promise<T> {
		if (this.closing || this.pending.size >= this.maximumRequests) {
			throw new AgentFailure('provider_unavailable');
		}
		const pending = Promise.resolve().then(work);
		this.pending.add(pending);
		try {
			return await pending;
		} finally {
			this.pending.delete(pending);
		}
	}

	quiesce(): void {
		if (this.closing) {
			return;
		}
		this.closing = true;
		for (const resource of this.resources) {
			try {
				resource.quiesce();
			} catch (error) {
				this.stopFailures.push(error);
			}
		}
	}

	close(): Promise<void> {
		if (this.closePromise) {
			return this.closePromise;
		}
		const admitted = [...this.pending];
		this.closePromise = Promise.resolve().then(async () => {
			const requests = await Promise.allSettled(admitted);
			// Provider post-network writes and Registry's last-subscriber refresh must
			// settle before SQLite is closed, even when the HTTP subscriber has left.
			const resources = await Promise.allSettled(
				this.resources.map((resource) => Promise.resolve().then(() => resource.close())),
			);
			const failures: unknown[] = [...this.stopFailures];
			for (const result of requests) {
				if (result.status === 'rejected' && !(result.reason instanceof AgentFailure)) {
					failures.push(result.reason);
				}
			}
			for (const result of resources) {
				if (result.status === 'rejected') {
					failures.push(result.reason);
				}
			}
			if (failures.length) {
				throw new AggregateError(failures, 'Agent shutdown failed');
			}
		});
		this.quiesce();
		return this.closePromise;
	}
}
