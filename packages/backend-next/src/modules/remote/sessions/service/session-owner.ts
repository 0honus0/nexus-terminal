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
	private accepting = true;
	private closePromise: Promise<void> | null = null;

	constructor(
		private readonly access: AccessPublicApi,
		private readonly remote: RemoteSessions,
	) {}

	private async identity(token: string | null): Promise<number> {
		if (!token) throw new RemotePermissionError('unauthenticated');
		const identity = await this.access.authenticate(token);
		if (!identity) throw new RemotePermissionError('unauthenticated');
		if (identity.userId !== 1) throw new RemotePermissionError('forbidden');
		return identity.userId;
	}

	private track<T>(task: Promise<T>): Promise<T> {
		this.pending.add(task);
		void task.finally(() => this.pending.delete(task)).catch(() => undefined);
		return task;
	}

	async open(token: string | null, request: OpenShellRequest): Promise<SessionView> {
		if (!this.accepting) throw new RemotePermissionError('remote_unavailable');
		const userId = await this.identity(token);
		if (!this.accepting) throw new RemotePermissionError('remote_unavailable');
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
				if (!record.attached) void this.release(view.id).catch(() => undefined);
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
		return this.track(this.checkAllowed(token, id));
	}

	private async checkAllowed(token: string | null, id: string): Promise<boolean> {
		if (!this.accepting || !token) return false;
		const owner = this.owners.get(id);
		if (!owner || owner.tokenDigest !== digest(token) || this.remote.get(id) === null) return false;
		try {
			return (await this.identity(token)) === owner.userId && this.owners.get(id) === owner;
		} catch {
			return false;
		}
	}

	async get(token: string | null, id: string): Promise<SessionView | null> {
		if (!(await this.allowed(token, id))) return null;
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
		if (!(await this.allowed(token, id))) return false;
		await this.release(id);
		return true;
	}

	attach(token: string, id: string): boolean {
		if (!this.accepting || this.remote.get(id) === null) return false;
		const owner = this.owners.get(id);
		if (!owner || owner.attached || owner.tokenDigest !== digest(token)) return false;
		owner.attached = true;
		if (owner.attachDeadline) clearTimeout(owner.attachDeadline);
		owner.attachDeadline = null;
		return true;
	}

	/** The transport closing destroys the PTY: no implicit detach or restoration. */
	async release(id: string): Promise<void> {
		const owner = this.owners.get(id);
		if (!owner) return;
		this.owners.delete(id);
		if (owner.attachDeadline) clearTimeout(owner.attachDeadline);
		await this.track(this.remote.closeSession(id));
	}

	quiesce(): void {
		this.accepting = false;
	}

	close(): Promise<void> {
		if (this.closePromise) return this.closePromise;
		this.quiesce();
		this.closePromise = (async () => {
			const failures = await Promise.allSettled([...this.owners.keys()].map((id) => this.release(id)));
			await Promise.allSettled([...this.pending]);
			const rejected = failures.filter((item): item is PromiseRejectedResult => item.status === 'rejected');
			if (rejected.length)
				throw new AggregateError(
					rejected.map((item) => item.reason),
					'Remote owner shutdown failed',
				);
		})();
		return this.closePromise;
	}
}
