import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import { createHash, randomUUID } from 'node:crypto';
import { FailureSummary } from '../../../../platform/lifecycle/failure-summary.js';
import { RecentResults } from '../../../../platform/lifecycle/recent-results.js';
import type { AccessPublicApi } from '../../../access/public.js';

import {
	RemoteFileFailure,
	type FileEntry,
	type FileInfo,
	type FileResource,
	type OpenedFile,
	type TextRead,
} from '../model/file-types.js';
import type { RemoteFileModel } from '../model/file-model.js';

interface OwnedResource {
	id: string;
	tokenHash: string;
	userId: number;
	resource: FileResource;
	expiresAt: number;
	busy: boolean;
	active: AbortController | null;
	inFlight: Promise<unknown> | null;
	closePromise: Promise<void> | null;
}

/** Server-owned admission and lifecycle policy; these values are not wire budgets. */
const MAX_FILE_RESOURCES = 8;
const FILE_IDLE_MS = 2 * 60 * 1000;
const FILE_OPERATION_MS = 30 * 1000;
const FILE_CLOSE_REPLAY_MS = 2 * 60 * 1000;

/** Private completed-close cache capacity, independent of PTY sessions. */
const MAX_RECENTLY_CLOSED_FILES = 128;

interface ReleasedFile {
	userId: number;
	tokenHash: string;
	completion: Promise<void>;
}

function hash(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

export class RemoteFileService {
	private readonly owners = new Map<string, OwnedResource>();
	private readonly authorizing = new Set<AbortController>();
	private readonly opening = new Set<AbortController>();
	private readonly releasingRequests = new Set<AbortController>();
	private readonly pending = new Set<Promise<unknown>>();
	private readonly closing = new Map<string, ReleasedFile>();
	private readonly recentlyClosed = new RecentResults<string, ReleasedFile>(
		MAX_RECENTLY_CLOSED_FILES,
		FILE_CLOSE_REPLAY_MS,
	);
	private readonly cleanupFailures = new FailureSummary();
	private accepting = true;
	private closePromise: Promise<void> | null = null;
	private readonly expiryTimer: ReturnType<typeof setInterval>;

	constructor(
		private readonly access: AccessPublicApi,
		private readonly model: RemoteFileModel,
	) {
		this.expiryTimer = setInterval(() => {
			for (const record of this.owners.values()) {
				if (record.expiresAt <= Date.now()) {
					void this.closeOwned(record).catch(() => undefined);
				}
			}
		}, 15_000);
		this.expiryTimer.unref();
	}

	private async identity(token: string | null): Promise<number> {
		if (!token) {
			throw new RemoteFileFailure('unauthenticated');
		}
		const identity = await this.access.authenticate(token);
		if (!identity) {
			throw new RemoteFileFailure('unauthenticated');
		}
		if (identity.userId !== 1) {
			throw new RemoteFileFailure('forbidden');
		}
		return identity.userId;
	}

	private track<T>(operation: Promise<T>): Promise<T> {
		this.pending.add(operation);
		void operation.finally(() => this.pending.delete(operation)).catch(() => undefined);
		return operation;
	}

	/** Access and Targets do not accept an AbortSignal; discard their late results after cancellation. */
	private async untilAbort<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
		if (signal.aborted) {
			// A caller may have created a non-cancellable Access promise before this check.
			void task.catch(() => undefined);
			throw new RemoteFileFailure('remote_unavailable');
		}

		let listener: () => void = () => undefined;

		const cancellation = new Promise<never>((_, reject) => {
			listener = () => reject(new RemoteFileFailure('remote_unavailable'));
			signal.addEventListener('abort', listener, { once: true });
		});
		try {
			return await Promise.race([task, cancellation]);
		} finally {
			signal.removeEventListener('abort', listener);
		}
	}

	open(token: string | null, targetId: number, signal?: AbortSignal): Promise<OpenedFile> {
		return this.track(this.openAdmitted(token, targetId, signal));
	}

	private async openAdmitted(token: string | null, targetId: number, signal?: AbortSignal): Promise<OpenedFile> {
		if (!this.accepting) {
			throw new RemoteFileFailure('remote_unavailable');
		}
		if (!Number.isSafeInteger(targetId) || targetId < 1) {
			throw new RemoteFileFailure('invalid_input');
		}
		const controller = new AbortController();

		const abort = () => controller.abort();

		signal?.addEventListener('abort', abort, { once: true });
		if (signal?.aborted) {
			abort();
		}
		const started = Date.now();
		const timer = setTimeout(abort, FILE_OPERATION_MS);
		this.authorizing.add(controller);
		let resource: FileResource | null = null;
		let lateOpeningCleanup: Promise<void> | null = null;
		try {
			const userId = await this.untilAbort(this.identity(token), controller.signal);
			this.authorizing.delete(controller);
			if (!this.accepting || controller.signal.aborted) {
				throw new RemoteFileFailure('remote_unavailable');
			}
			if (this.owners.size + this.opening.size + this.closing.size >= MAX_FILE_RESOURCES) {
				throw new RemoteFileFailure('limit_exceeded');
			}
			this.opening.add(controller);
			const opening = this.model.open(
				targetId,
				Math.max(1, FILE_OPERATION_MS - (Date.now() - started)),
				controller.signal,
			);
			try {
				resource = await this.untilAbort(opening, controller.signal);
			} catch (error) {
				// Keep the quota slot reserved and make shutdown wait for late
				// non-cancellable success to be closed by its actual resource owner.
				lateOpeningCleanup = this.track(
					opening
						.then(
							async (late) => {
								try {
									await late.close();
								} catch (cleanup) {
									this.cleanupFailures.record(cleanup);
								}
							},
							(error: unknown) => {
								if (error instanceof RemoteResourceCleanupFailure) {
									this.cleanupFailures.record(error);
								}
							},
						)
						.finally(() => this.opening.delete(controller)),
				);
				throw error;
			}
			if (
				!token ||
				(await this.untilAbort(this.identity(token), controller.signal)) !== userId ||
				!this.accepting ||
				controller.signal.aborted
			) {
				throw new RemoteFileFailure('unauthenticated');
			}
			if (!resource.isOpen) {
				throw new RemoteFileFailure('remote_unavailable');
			}
			const id = randomUUID();
			const record: OwnedResource = {
				id,
				tokenHash: hash(token),
				userId,
				resource,
				expiresAt: Date.now() + FILE_IDLE_MS,
				busy: false,
				active: null,
				inFlight: null,
				closePromise: null,
			};
			this.owners.set(id, record);
			resource = null;
			return { id, targetId: record.resource.targetId, fingerprint: record.resource.fingerprint };
		} catch (error) {
			if (resource) {
				try {
					await resource.close();
				} catch (cleanup) {
					const failure = new RemoteResourceCleanupFailure([error, cleanup]);
					this.cleanupFailures.record(failure);
					throw failure;
				}
			}
			throw error;
		} finally {
			this.authorizing.delete(controller);
			if (lateOpeningCleanup === null) {
				this.opening.delete(controller);
			}
			clearTimeout(timer);
			signal?.removeEventListener('abort', abort);
		}
	}

	private async owned(token: string | null, id: string): Promise<OwnedResource> {
		if (!this.accepting) {
			throw new RemoteFileFailure('remote_unavailable');
		}
		const userId = await this.identity(token);
		const record = this.owners.get(id);
		if (
			!record ||
			!token ||
			record.userId !== userId ||
			record.tokenHash !== hash(token) ||
			record.closePromise ||
			!record.resource.isOpen ||
			record.expiresAt <= Date.now() ||
			!this.accepting
		) {
			throw new RemoteFileFailure('not_found');
		}
		return record;
	}

	private run<T>(
		token: string | null,
		id: string,
		action: (resource: FileResource, remainingMs: number, signal: AbortSignal) => Promise<T>,
		requestSignal?: AbortSignal,
	): Promise<T> {
		return this.track(this.runAdmitted(token, id, action, requestSignal));
	}

	private async runAdmitted<T>(
		token: string | null,
		id: string,
		action: (resource: FileResource, remainingMs: number, signal: AbortSignal) => Promise<T>,
		requestSignal?: AbortSignal,
	): Promise<T> {
		const controller = new AbortController();

		const abort = () => controller.abort();

		requestSignal?.addEventListener('abort', abort, { once: true });
		if (requestSignal?.aborted) {
			abort();
		}
		const started = Date.now();
		const timer = setTimeout(abort, FILE_OPERATION_MS);
		let record: OwnedResource | null = null;
		try {
			record = await this.untilAbort(this.owned(token, id), controller.signal);
			if (
				!this.accepting ||
				record.closePromise ||
				this.owners.get(id) !== record ||
				record.expiresAt <= Date.now()
			) {
				throw new RemoteFileFailure('not_found');
			}
			if (record.busy) {
				throw new RemoteFileFailure('limit_exceeded');
			}
			record.busy = true;
			record.active = controller;
			const operation = this.executeOwned(record, token, id, action, controller.signal, started);
			record.inFlight = operation;
			return await operation;
		} finally {
			if (record?.active === controller) {
				record.inFlight = null;
				record.active = null;
				record.busy = false;
				if (controller.signal.aborted || !record.resource.isOpen) {
					void this.closeOwned(record).catch(() => undefined);
				}
			}
			clearTimeout(timer);
			requestSignal?.removeEventListener('abort', abort);
		}
	}

	private async executeOwned<T>(
		record: OwnedResource,
		token: string | null,
		id: string,
		action: (resource: FileResource, remainingMs: number, signal: AbortSignal) => Promise<T>,
		signal: AbortSignal,
		started: number,
	): Promise<T> {
		await this.untilAbort(this.model.checkFingerprint(record.resource), signal);
		signal.throwIfAborted();
		const result = await action(record.resource, Math.max(1, FILE_OPERATION_MS - (Date.now() - started)), signal);
		signal.throwIfAborted();
		await this.untilAbort(this.model.checkFingerprint(record.resource), signal);
		signal.throwIfAborted();
		if (!this.accepting || record.closePromise || this.owners.get(id) !== record) {
			throw new RemoteFileFailure('not_found');
		}
		if (
			(await this.untilAbort(this.identity(token), signal)) !== record.userId ||
			!this.accepting ||
			record.closePromise ||
			this.owners.get(id) !== record
		) {
			throw new RemoteFileFailure('unauthenticated');
		}
		signal.throwIfAborted();
		record.expiresAt = Date.now() + FILE_IDLE_MS;
		return result;
	}

	list(
		token: string | null,
		id: string,
		path: string,
		maxEntries: number,
		maxMetadataBytes: number,
		signal?: AbortSignal,
	): Promise<FileEntry[]> {
		return this.run(
			token,
			id,
			(resource, ms, abort) =>
				resource.list({ path, timeoutMs: ms, signal: abort, maxEntries, maxMetadataBytes }),
			signal,
		);
	}

	stat(token: string | null, id: string, path: string, follow: boolean, signal?: AbortSignal): Promise<FileInfo> {
		return this.run(
			token,
			id,
			(resource, ms, abort) => resource.stat({ path, followLinks: follow, timeoutMs: ms, signal: abort }),
			signal,
		);
	}

	readText(
		token: string | null,
		id: string,
		path: string,
		maxBytes: number,
		signal?: AbortSignal,
	): Promise<TextRead> {
		return this.run(
			token,
			id,
			(resource, ms, abort) => resource.readText({ path, maxBytes, timeoutMs: ms, signal: abort }),
			signal,
		);
	}

	release(token: string | null, id: string, signal?: AbortSignal): Promise<void> {
		return this.track(this.releaseAdmitted(token, id, signal));
	}

	private async releaseAdmitted(token: string | null, id: string, signal?: AbortSignal): Promise<void> {
		const controller = new AbortController();

		const abort = () => controller.abort();

		signal?.addEventListener('abort', abort, { once: true });
		if (signal?.aborted) {
			abort();
		}
		const timer = setTimeout(abort, FILE_OPERATION_MS);
		this.releasingRequests.add(controller);
		try {
			await this.releaseIdentified(token, id, controller.signal);
		} finally {
			this.releasingRequests.delete(controller);
			clearTimeout(timer);
			signal?.removeEventListener('abort', abort);
		}
	}

	private async releaseIdentified(token: string | null, id: string, signal: AbortSignal): Promise<void> {
		if (!token) {
			throw new RemoteFileFailure('unauthenticated');
		}
		const userId = await this.untilAbort(this.identity(token), signal);
		const current = this.owners.get(id);
		const finished = this.closing.get(id) ?? this.recentlyClosed.get(id);
		const record = current ?? finished;
		if (!record || record.userId !== userId || record.tokenHash !== hash(token)) {
			throw new RemoteFileFailure('not_found');
		}
		if (current) {
			if (this.owners.get(id) !== current) {
				throw new RemoteFileFailure('not_found');
			}
			await this.closeOwned(current);
		} else if (finished) {
			await finished.completion;
		}
	}

	private closeOwned(record: OwnedResource): Promise<void> {
		if (record.closePromise) {
			return record.closePromise;
		}
		// Save completion before scheduling cleanup; a concurrent DELETE sees the same result.
		const completion = Promise.resolve().then(async () => {
			if (record.inFlight) {
				await Promise.allSettled([record.inFlight]);
			}
			await record.resource.close();
		});
		record.closePromise = completion;
		this.closing.set(record.id, {
			userId: record.userId,
			tokenHash: record.tokenHash,
			completion,
		});
		this.owners.delete(record.id);
		record.active?.abort();
		void completion.then(
			() => this.rememberClosed(record.id, completion),
			(error) => {
				this.cleanupFailures.record(error);
				this.rememberClosed(record.id, completion);
			},
		);
		return completion;
	}

	private rememberClosed(id: string, completion: Promise<void>): void {
		const record = this.closing.get(id);
		if (record?.completion === completion) {
			this.closing.delete(id);
			this.recentlyClosed.set(id, record);
		}
	}

	quiesce(): void {
		this.accepting = false;
		for (const controller of this.authorizing) {
			controller.abort();
		}
		for (const controller of this.opening) {
			controller.abort();
		}
		for (const controller of this.releasingRequests) {
			controller.abort();
		}
		for (const record of this.owners.values()) {
			record.active?.abort();
		}
	}

	close(): Promise<void> {
		if (this.closePromise) {
			return this.closePromise;
		}
		this.quiesce();
		clearInterval(this.expiryTimer);
		this.closePromise = (async () => {
			const results = await Promise.allSettled(
				[...this.owners.values()].map((record) => this.closeOwned(record)),
			);
			while (this.pending.size || this.closing.size) {
				await Promise.allSettled([
					...this.pending,
					...[...this.closing.values()].map((record) => record.completion),
				]);
			}
			const failures = results
				.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
				.map((result) => result.reason);
			failures.push(...this.cleanupFailures.errors());
			if (failures.length) {
				throw new AggregateError([...new Set(failures)], 'Remote file shutdown failed');
			}
		})();
		return this.closePromise;
	}
}
