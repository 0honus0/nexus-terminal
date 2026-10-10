import { createHash } from 'node:crypto';
import type { AccessPublicApi } from '../../../access/public.js';
import type { RemoteSessions, OpenShellRequest, SessionView } from '../../public.js';

export type RemotePermissionCode = 'unauthenticated' | 'forbidden' | 'not_found' | 'remote_unavailable';

export class RemotePermissionError extends Error {
	constructor(readonly code: RemotePermissionCode) {
		super('Remote: ' + code);
	}
}

interface Owner {
	userId: number;
	tokenDigest: string;
	attached: boolean;
	attachDeadline: ReturnType<typeof setTimeout> | null;
}

interface ReleasedSession {
	userId: number;
	tokenDigest: string;
	completion: Promise<void>;
	expiresAt: number;
}

const CLOSED_SESSION_TTL_MS = 120_000;
const MAX_RECENTLY_RELEASED = 128;

function digest(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

/**
 * Each shell belongs to one authenticated Access session, not merely a user ID.
 * No detach/resume contract is installed: websocket disconnect closes the PTY.
 */
export class RemoteSessionOwner {
	private readonly owners = new Map<string, Owner>();
	private readonly pending = new Set<Promise<unknown>>();
	private readonly releasing = new Map<string, Promise<void>>();
	private readonly recentlyReleased = new Map<string, ReleasedSession>();
	private readonly cleanupFailures: unknown[] = [];
	private accepting = true;
	private closePromise: Promise<void> | null = null;

	constructor(
		private readonly access: AccessPublicApi,
		private readonly remote: RemoteSessions,
	) {}

	private async identity(token: string | null): Promise<number> {
		if (!token) {
			throw new RemotePermissionError('unauthenticated');
		}
		const identity = await this.access.authenticate(token);
		if (!identity) {
			throw new RemotePermissionError('unauthenticated');
		}
		if (identity.userId !== 1) {
			throw new RemotePermissionError('forbidden');
		}
		return identity.userId;
	}

	private track<T>(task: Promise<T>): Promise<T> {
		this.pending.add(task);
		void task.finally(() => this.pending.delete(task)).catch(() => undefined);
		return task;
	}

	async open(token: string | null, request: OpenShellRequest): Promise<SessionView> {
		if (!this.accepting) {
			throw new RemotePermissionError('remote_unavailable');
		}
		const userId = await this.identity(token);
		if (!this.accepting) {
			throw new RemotePermissionError('remote_unavailable');
		}
		const task = this.remote.open({
			targetId: request.targetId,
			columns: request.columns,
			rows: request.rows,
			timeoutMs: request.timeoutMs,
			term: request.term,
			signal: request.signal,
		});
		const view = await this.track(task);
		try {
			if (!this.accepting || !token || (await this.identity(token)) !== userId) {
				throw new RemotePermissionError('unauthenticated');
			}
			const record: Owner = {
				userId,
				tokenDigest: digest(token),
				attached: false,
				attachDeadline: null,
			};
			// Do not strand a privileged PTY when an HTTP caller never attaches.
			record.attachDeadline = setTimeout(() => {
				if (!record.attached) {
					void this.release(view.id).catch(() => undefined);
				}
			}, 30_000);
			record.attachDeadline.unref();
			this.owners.set(view.id, record);
			return {
				id: view.id,
				targetId: view.targetId,
				fingerprint: view.fingerprint,
				startedAt: view.startedAt,
				status: view.status,
			};
		} catch (error) {
			try {
				await this.remote.closeSession(view.id);
			} catch (cleanup) {
				throw new AggregateError([error, cleanup], 'Remote open cleanup failed');
			}
			throw error;
		}
	}

	allowed(token: string | null, id: string): Promise<boolean> {
		return this.track(this.checkAllowed(token, id, true));
	}

	/** Normal EOF can drain already-read bytes even after the PTY leaves active sessions. */
	allowedOutput(token: string | null, id: string): Promise<boolean> {
		return this.track(this.checkAllowed(token, id, false));
	}

	private async checkAllowed(token: string | null, id: string, active: boolean): Promise<boolean> {
		if (!this.accepting || !token) {
			return false;
		}
		const owner = this.owners.get(id);
		if (!owner || owner.tokenDigest !== digest(token) || (active && this.remote.get(id) === null)) {
			return false;
		}
		try {
			return (await this.identity(token)) === owner.userId && this.owners.get(id) === owner;
		} catch {
			return false;
		}
	}

	async get(token: string | null, id: string): Promise<SessionView | null> {
		if (!(await this.allowed(token, id))) {
			return null;
		}
		const view = this.remote.get(id);
		return view
			? {
					id: view.id,
					targetId: view.targetId,
					fingerprint: view.fingerprint,
					startedAt: view.startedAt,
					status: view.status,
				}
			: null;
	}

	async closeSession(token: string | null, id: string): Promise<boolean> {
		if (!token) {
			return false;
		}
		this.pruneRecentlyReleased();
		const owner = this.owners.get(id);
		const completed = this.recentlyReleased.get(id);
		const record = owner ?? completed;
		if (!record || record.tokenDigest !== digest(token)) {
			return false;
		}
		try {
			if ((await this.identity(token)) !== record.userId) {
				return false;
			}
		} catch {
			return false;
		}
		// A valid same-session DELETE must see the original cleanup outcome even
		// if the WebSocket already released the underlying PTY.
		if (owner) {
			await this.release(id);
		} else if (completed) {
			await completed.completion;
		}
		return true;
	}

	attach(token: string, id: string): boolean {
		if (!this.accepting || this.remote.get(id) === null) {
			return false;
		}
		const owner = this.owners.get(id);
		if (!owner || owner.attached || owner.tokenDigest !== digest(token)) {
			return false;
		}
		owner.attached = true;
		if (owner.attachDeadline) {
			clearTimeout(owner.attachDeadline);
		}
		owner.attachDeadline = null;
		return true;
	}

	/** The transport closing destroys the PTY: no implicit detach or restoration. */
	release(id: string): Promise<void> {
		const existing = this.releasing.get(id);
		if (existing) {
			return existing;
		}
		const completed = this.recentlyReleased.get(id);
		if (completed) {
			return completed.completion;
		}
		const owner = this.owners.get(id);
		if (!owner) {
			return Promise.resolve();
		}
		this.owners.delete(id);
		if (owner.attachDeadline) {
			clearTimeout(owner.attachDeadline);
		}
		const task = Promise.resolve().then(() => this.remote.closeSession(id));
		this.releasing.set(id, task);
		this.pruneRecentlyReleased();
		this.recentlyReleased.set(id, {
			userId: owner.userId,
			tokenDigest: owner.tokenDigest,
			completion: task,
			expiresAt: Date.now() + CLOSED_SESSION_TTL_MS,
		});
		this.track(task);
		void task.then(
			() => this.releasing.delete(id),
			(error) => {
				this.cleanupFailures.push(error);
				// Preserve the failed Promise for a repeat release as well as shutdown.
				// A second caller must not mistake failed cleanup for success.
			},
		);
		return task;
	}

	private pruneRecentlyReleased(): void {
		const now = Date.now();
		for (const [id, record] of this.recentlyReleased) {
			if (record.expiresAt <= now) {
				this.recentlyReleased.delete(id);
			}
		}
		while (this.recentlyReleased.size >= MAX_RECENTLY_RELEASED) {
			const oldest = this.recentlyReleased.keys().next().value;
			if (oldest === undefined) {
				break;
			}
			this.recentlyReleased.delete(oldest);
		}
	}

	quiesce(): void {
		this.accepting = false;
	}

	close(): Promise<void> {
		if (this.closePromise) {
			return this.closePromise;
		}
		this.quiesce();
		this.closePromise = (async () => {
			const failures = await Promise.allSettled([...this.owners.keys()].map((id) => this.release(id)));
			while (this.pending.size) {
				await Promise.allSettled([...this.pending]);
			}
			const errors = failures
				.filter((item): item is PromiseRejectedResult => item.status === 'rejected')
				.map((item) => item.reason);
			errors.push(...this.cleanupFailures);
			if (errors.length) {
				throw new AggregateError([...new Set(errors)], 'Remote owner shutdown failed');
			}
		})();
		return this.closePromise;
	}
}
