import { isWellFormedFileText } from '@nexus-terminal/shared/remote/files/text-codec';
import {
	WORKSPACE_UPLOAD_MAX_CHUNK_BYTES,
	WORKSPACE_ARCHIVE_MAX_PASSWORD_CODE_POINTS,
	WORKSPACE_UPLOAD_MAX_PREPARE_DIRECTORIES,
	WORKSPACE_TRANSFER_MAX_SOURCES,
} from '@nexus-terminal/shared/remote/transfers/values';
import { selectDownloadRange } from './file-download-rules.js';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { supportsFileEncoding, encodeFileText } from '../model/file-text-model.js';
import { FailureSummary } from '../../../../platform/lifecycle/failure-summary.js';
import { RecentResults } from '../../../../platform/lifecycle/recent-results.js';
import type { AccessPublicApi } from '../../../access/public.js';
import type { TargetsPublicApi } from '../../../targets/public.js';
import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import {
	REMOTE_FILE_MAX_TEXT_BYTES,
	REMOTE_FILE_MAX_PATH_BYTES,
	WORKSPACE_FILES_MAX_BINARY_READ_BYTES,
} from '@nexus-terminal/shared/remote/files/values';
import {
	RemoteFileFailure,
	FileDownloadTicketFailure,
	FileRangeNotSatisfiable,
	type FileReadSelection,
	FileCommandNotStarted,
	type FileDirectoryResult,
	type FileEntry,
	type FileInfo,
	type FileDownloadPlan,
	type FileDownloadSink,
	type FileDownloadTicketBinding,
	type FilePathEntry,
	type FileRemoveResult,
	type FileRenameResult,
	type FileResource,
	type FileSearchResult,
	type FileStagedWrite,
	type FileUploadStage,
	type FileAttachment,
	type WorkspaceFileAttachment,
	type FileBinaryEmit,
	type ResolvedFilePath,
	type TextRead,
	type TextWrite,
} from '../model/file-types.js';
import type { RemoteFileModel } from '../model/file-model.js';
import { searchFiles } from './file-search.js';
import { DownloadTickets } from './download-tickets.js';
import type { FileUploadStart, FileUploadEvent, FileUploadStreamAttachment } from '../model/file-upload-types.js';
import type { FileCopyMoveEvent, FileArchiveEvent, FileArchiveOperation } from '../model/file-task-types.js';
import { copyRemoteEntries } from './file-copy.js';
import { streamRemoteDirectoryZip } from './file-directory-zip.js';
import { compressRemoteArchive, decompressRemoteArchive } from './file-archive.js';
import { ArchiveRejection, type FileArchiveRequest, type ArchiveFormat } from '../model/file-task-types.js';

interface OwnedResource {
	id: string;
	workspaceId?: string;
	tokenHash: string;
	userId: number;
	resource: FileResource;
	expiresAt: number;
	active: Set<AbortController>;
	inFlight: Set<Promise<unknown>>;
	mutationTail: Promise<void>;
	closePromise: Promise<void> | null;
}

/** Server-owned admission/lifecycle policy; not wire budgets. */
const MAX_FILE_RESOURCES = 8;
const MAX_WORKSPACE_ATTACHMENTS = 64;
const MAX_WORKSPACE_TRANSFERS = 16;
const FILE_IDLE_MS = 2 * 60 * 1000;
const FILE_OPERATION_MS = 30 * 1000;
const FILE_TRANSFER_MS = 60 * 60 * 1000;
const FILE_UPLOAD_IDLE_MS = 5 * 60 * 1000;
const FILE_CLOSE_REPLAY_MS = 2 * 60 * 1000;
const MAX_RECENTLY_CLOSED_FILES = 128;

interface ReleasedFile {
	userId: number;
	tokenHash: string;
	completion: Promise<void>;
	workspaceId?: string;
}

interface PreparedUpload {
	workspaceId: string;
	ownerId: string;
	root: string;
	directories: ReadonlySet<string>;
	expiresAt: number;
}

interface TransferResourceOwner {
	finished: boolean;
	cleanupFailure: RemoteResourceCleanupFailure | null;
	readonly cleanupOwnerIds: readonly string[];
}

type FileResourceUse = 'direct' | 'dedicated_transfer';

interface RunningUpload extends TransferResourceOwner {
	workspaceId: string;
	ownerId: string;
	uploadId: string;
	tokenHash: string;
	path: string;
	size: number;
	accepted: number;
	nextIndex: number;
	controller: AbortController;
	stage: FileUploadStage | null;
	queue: Promise<void>;
	completion: Promise<void>;
	terminal: boolean;
	cancelled: boolean;
	mutationStarted: boolean;
	streamAttached: boolean;
	idleTimer?: ReturnType<typeof setTimeout>;
	complete(): void;
	fail(error: unknown): void;
	emit(event: FileUploadEvent): void;
}

interface RunningCopyMove extends TransferResourceOwner {
	workspaceId: string;
	ownerId: string;
	sourceWorkspaceId: string;
	sourceOwnerId: string;
	requestId: string;
	tokenHash: string;
	controller: AbortController;
	cancelled: boolean;
	emit(event: FileCopyMoveEvent): void;
}

interface RunningArchive extends TransferResourceOwner {
	workspaceId: string;
	ownerId: string;
	requestId: string;
	tokenHash: string;
	controller: AbortController;
	cancelled: boolean;
	mutationStarted: boolean;
	operation: FileArchiveOperation;
}

function tokenHash(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

/** Protocol-specific limits are decoded before this application path policy. */
function remotePath(value: string, destructive = false): string {
	if (typeof value !== 'string' || !value || value.includes('\0') || !isWellFormedFileText(value)) {
		throw new RemoteFileFailure('invalid_input');
	}
	const normalized = path.posix.normalize(value);
	if (!path.posix.isAbsolute(normalized) || (destructive && normalized === '/')) {
		throw new RemoteFileFailure('invalid_input');
	}
	return normalized;
}

function remoteTransferPath(value: string, destructive = false): string {
	const normalized = remotePath(value, destructive);
	if (Buffer.byteLength(normalized, 'utf8') > REMOTE_FILE_MAX_PATH_BYTES) {
		throw new RemoteFileFailure('invalid_input');
	}
	return normalized;
}

function safeEncoding(value: string | undefined): string {
	const requested = (value ?? 'utf-8').toLowerCase().replace(/[^a-z0-9]/gu, '');
	return supportsFileEncoding(requested) ? requested : 'utf-8';
}

function encodeText(content: string, encoding?: string): Uint8Array {
	const normalized = safeEncoding(encoding);
	const source = content.startsWith('\uFEFF') ? content.slice(1) : content;
	const encoded = encodeFileText(source, normalized);
	if (normalized === 'utf16le') {
		return Uint8Array.from(Buffer.concat([Buffer.from([0xff, 0xfe]), encoded]));
	}
	if (normalized === 'utf16be') {
		return Uint8Array.from(Buffer.concat([Buffer.from([0xfe, 0xff]), encoded]));
	}
	return Uint8Array.from(encoded);
}

function sha256(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function sortEntries(entries: FileEntry[]): FileEntry[] {
	const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
	return [...entries].sort(
		(a, b) =>
			Number(b.info.kind === 'directory') - Number(a.info.kind === 'directory') ||
			collator.compare(a.name, b.name) ||
			(a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
	);
}

function isUnknown(error: unknown): boolean {
	return (
		error instanceof RemoteResourceCleanupFailure ||
		(error instanceof RemoteFileFailure && error.code === 'operation_unknown')
	);
}

export class RemoteFileService {
	private readonly downloadTickets = new DownloadTickets();
	private readonly uploads = new Map<string, RunningUpload>();
	private readonly copyMoves = new Map<string, RunningCopyMove>();
	private readonly archives = new Map<string, RunningArchive>();
	private readonly preparedUploads = new Map<string, PreparedUpload>();
	private readonly preparingUploads = new Map<string, { workspaceId: string; ownerId: string }>();
	private readonly transferCleanupByOwner = new Map<string, RemoteResourceCleanupFailure>();
	private readonly owners = new Map<string, OwnedResource>();
	private readonly authorizing = new Set<AbortController>();
	private readonly opening = new Set<AbortController>();
	private readonly independentOpening = new Set<AbortController>();
	private readonly workspaceReservations = new Set<string>();
	/** Failed cleanup is still charged; it is not evidence that the lease was released. */
	private readonly unconfirmedIndependentClosures = new Set<string>();
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
		private readonly targets: Pick<TargetsPublicApi, 'get'>,
	) {
		this.expiryTimer = setInterval(() => {
			for (const record of this.owners.values()) {
				// Active transfers must not be culled when their idle TTL elapses.
				// A Workspace lease is owned by its shell lifecycle across disconnects.
				// An independent File resource alone uses this idle expiration policy.
				if (record.workspaceId === undefined && record.active.size === 0 && record.expiresAt <= Date.now()) {
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

	private async untilAbort<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
		if (signal.aborted) {
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

	open(token: string | null, targetId: number, signal?: AbortSignal): Promise<FileAttachment> {
		return this.track(this.openAdmitted(token, targetId, signal));
	}

	openWorkspace(
		token: string | null,
		workspaceId: string,
		targetId: number,
		signal?: AbortSignal,
	): Promise<WorkspaceFileAttachment> {
		if (!/^[A-Za-z0-9_-]{8,128}$/u.test(workspaceId)) {
			throw new RemoteFileFailure('invalid_input');
		}
		return this.track(this.openAdmitted(token, targetId, signal, workspaceId));
	}

	private openAdmitted(
		token: string | null,
		targetId: number,
		signal: AbortSignal | undefined,
		workspaceId: string,
	): Promise<WorkspaceFileAttachment>;

	private openAdmitted(token: string | null, targetId: number, signal?: AbortSignal): Promise<FileAttachment>;

	private async openAdmitted(
		token: string | null,
		targetId: number,
		signal?: AbortSignal,
		workspaceId?: string,
	): Promise<FileAttachment | WorkspaceFileAttachment> {
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
		const openingState: { lateCleanup: Promise<void> | null } = { lateCleanup: null };
		let reserved = false;
		let delivered = false;
		let cleanupUncertain = false;
		try {
			// Count pending Workspace attachments before auth/catalog awaits. The
			// reservation is also retained while SSH opening or cleanup is pending.
			controller.signal.throwIfAborted();
			if (workspaceId !== undefined) {
				if (this.workspaceReservations.has(workspaceId)) {
					throw new RemoteFileFailure('conflict');
				}
				if (this.workspaceReservations.size >= MAX_WORKSPACE_ATTACHMENTS) {
					throw new RemoteFileFailure('limit_exceeded');
				}
				this.workspaceReservations.add(workspaceId);
				reserved = true;
			}
			const userId = await this.untilAbort(this.identity(token), controller.signal);
			if (!this.accepting || controller.signal.aborted) {
				throw new RemoteFileFailure('remote_unavailable');
			}
			let connectionName: string | undefined;
			if (workspaceId !== undefined) {
				// Catalog lookup belongs to the same admitted deadline as SSH opening.
				const target = await this.untilAbort(this.targets.get(targetId), controller.signal);
				if (!target) {
					throw new RemoteFileFailure('not_found');
				}
				connectionName = target.name;
			} else {
				const independentOwners = [...this.owners.values()].filter(
					(record) => record.workspaceId === undefined,
				).length;
				const independentClosing = [...this.closing.values()].filter(
					(record) => record.workspaceId === undefined,
				).length;
				if (
					independentOwners +
						this.independentOpening.size +
						independentClosing +
						this.unconfirmedIndependentClosures.size >=
					MAX_FILE_RESOURCES
				) {
					throw new RemoteFileFailure('limit_exceeded');
				}
				this.independentOpening.add(controller);
			}
			// The controller stays in authorizing while a Targets catalog read is
			// pending, so quiesce aborts that wait rather than only the SSH phase.
			this.authorizing.delete(controller);
			this.opening.add(controller);
			const opening = this.model.open(
				targetId,
				Math.max(1, FILE_OPERATION_MS - (Date.now() - started)),
				controller.signal,
			);
			try {
				resource = await this.untilAbort(opening, controller.signal);
			} catch (error) {
				openingState.lateCleanup = this.track(
					opening
						.then(
							async (late) => {
								try {
									await late.close();
								} catch (cleanup) {
									this.cleanupFailures.record(cleanup);
									throw cleanup;
								}
							},
							(error: unknown) => {
								if (error instanceof RemoteResourceCleanupFailure) {
									this.cleanupFailures.record(error);
									throw error;
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
				workspaceId,
				tokenHash: tokenHash(token),
				userId,
				resource,
				expiresAt: Date.now() + FILE_IDLE_MS,
				active: new Set(),
				inFlight: new Set(),
				mutationTail: Promise.resolve(),
				closePromise: null,
			};
			this.owners.set(id, record);
			resource = null;
			delivered = true;
			return {
				id,
				targetId: record.resource.targetId,
				fingerprint: record.resource.fingerprint,

				release: () => this.closeOwned(record),

				connectionName,
			};
		} catch (error) {
			if (resource) {
				const abandoned = resource;
				// Do not extend the aborted connect deadline with SSH cleanup. Keep
				// both the actual cleanup task and its capacity reservation alive.
				cleanupUncertain = true;
				const cleanup = this.track(
					Promise.resolve()
						.then(() => abandoned.close())
						.catch((failure: unknown) => {
							const combined = new RemoteResourceCleanupFailure([error, failure]);
							this.cleanupFailures.record(combined);
							throw combined;
						}),
				);
				openingState.lateCleanup = cleanup;
				void cleanup
					.then(() => {
						if (workspaceId !== undefined) {
							this.workspaceReservations.delete(workspaceId);
						} else {
							this.independentOpening.delete(controller);
						}
					})
					.catch(() => undefined)
					.finally(() => this.opening.delete(controller));
			}
			throw error;
		} finally {
			this.authorizing.delete(controller);
			const lateOpeningCleanup = openingState.lateCleanup;
			if (lateOpeningCleanup === null) {
				this.opening.delete(controller);
			}
			if (workspaceId === undefined) {
				if (!cleanupUncertain) {
					if (lateOpeningCleanup === null) {
						this.independentOpening.delete(controller);
					} else {
						void lateOpeningCleanup
							.then(() => this.independentOpening.delete(controller))
							.catch(() => undefined);
					}
				}
			} else if (reserved && !delivered && !cleanupUncertain) {
				if (lateOpeningCleanup === null) {
					this.workspaceReservations.delete(workspaceId);
				} else {
					void lateOpeningCleanup
						.then(() => this.workspaceReservations.delete(workspaceId))
						.catch(() => undefined);
				}
			}
			clearTimeout(timer);
			signal?.removeEventListener('abort', abort);
		}
	}

	/** A heartbeat is an authenticated, fingerprint-checked FileResource operation. */
	pingWorkspace(token: string | null, id: string, workspaceId: string, signal?: AbortSignal): Promise<void> {
		return this.run(
			token,
			id,
			async () => {
				if (this.owners.get(id)?.workspaceId !== workspaceId) {
					throw new RemoteFileFailure('not_found');
				}
			},
			signal,
		);
	}

	private async operationIdentity(
		token: string | null,
		authorization: 'bound_session' | 'same_user_workspace' | 'download_ticket',
	): Promise<number> {
		if (authorization !== 'download_ticket') {
			return this.identity(token);
		}
		const identity = token === null ? null : await this.access.authenticateDigest(token);
		if (!identity) {
			throw new RemoteFileFailure('unauthenticated');
		}
		if (identity.userId !== 1) {
			throw new RemoteFileFailure('forbidden');
		}
		return identity.userId;
	}

	private async owned(
		token: string | null,
		id: string,
		authorization: 'bound_session' | 'same_user_workspace' | 'download_ticket' = 'bound_session',
	): Promise<OwnedResource> {
		if (!this.accepting) {
			throw new RemoteFileFailure('remote_unavailable');
		}
		const userId = await this.operationIdentity(token, authorization);
		const record = this.owners.get(id);
		if (
			!record ||
			!token ||
			record.userId !== userId ||
			(authorization === 'bound_session' && record.tokenHash !== tokenHash(token)) ||
			(authorization === 'download_ticket' && record.tokenHash !== token) ||
			(authorization === 'same_user_workspace' && record.workspaceId === undefined) ||
			record.closePromise ||
			!record.resource.isOpen ||
			record.expiresAt <= Date.now() ||
			!this.accepting
		) {
			throw new RemoteFileFailure('not_found');
		}
		if (authorization === 'same_user_workspace') {
			// A source Workspace can belong to a different session of the same
			// user. Revalidate that source session by digest; never store a bearer.
			const sourceIdentity = await this.access.authenticateDigest(record.tokenHash);
			if (!sourceIdentity || sourceIdentity.userId !== userId) {
				throw new RemoteFileFailure('not_found');
			}
		}
		return record;
	}

	private run<T>(
		token: string | null,
		id: string,
		action: (resource: FileResource, remainingMs: number, signal: AbortSignal) => Promise<T>,
		requestSignal?: AbortSignal,
		mutation = false,
		timeoutMs = FILE_OPERATION_MS,
		authorization: 'bound_session' | 'same_user_workspace' | 'download_ticket' = 'bound_session',
		resourceUse: FileResourceUse = 'direct',
	): Promise<T> {
		return this.track(
			this.runAdmitted(token, id, action, requestSignal, mutation, timeoutMs, authorization, resourceUse),
		);
	}

	private async runAdmitted<T>(
		token: string | null,
		id: string,
		action: (resource: FileResource, remainingMs: number, signal: AbortSignal) => Promise<T>,
		requestSignal?: AbortSignal,
		mutation = false,
		timeoutMs = FILE_OPERATION_MS,
		authorization: 'bound_session' | 'same_user_workspace' | 'download_ticket' = 'bound_session',
		resourceUse: FileResourceUse = 'direct',
	): Promise<T> {
		const controller = new AbortController();

		const abort = () => controller.abort();

		requestSignal?.addEventListener('abort', abort, { once: true });
		if (requestSignal?.aborted) {
			abort();
		}
		const started = Date.now();
		const timer = setTimeout(abort, timeoutMs);
		let record: OwnedResource | null = null;
		let unlockMutation: (() => void) | null = null;
		let operationFinished!: () => void;
		const lifecycle = new Promise<void>((resolve) => {
			operationFinished = resolve;
		});
		let executing = false;
		this.authorizing.add(controller);
		try {
			record = await this.untilAbort(this.owned(token, id, authorization), controller.signal);
			this.authorizing.delete(controller);
			if (
				!this.accepting ||
				record.closePromise ||
				this.owners.get(id) !== record ||
				record.expiresAt <= Date.now()
			) {
				throw new RemoteFileFailure('not_found');
			}
			record.active.add(controller);
			record.inFlight.add(lifecycle);
			if (mutation) {
				const previous = record.mutationTail.catch(() => undefined);
				let unlock!: () => void;
				const gate = new Promise<void>((resolve) => {
					unlock = resolve;
				});
				record.mutationTail = previous.then(() => gate);
				unlockMutation = unlock;
				await this.untilAbort(previous, controller.signal);
				if (record.closePromise || this.owners.get(id) !== record) {
					throw new RemoteFileFailure('not_found');
				}
			}
			controller.signal.throwIfAborted();
			executing = true;
			const operation = this.executeOwned(
				record,
				token,
				id,
				action,
				controller.signal,
				started,
				mutation,
				timeoutMs,
				authorization,
			);
			try {
				return await operation;
			} catch (error) {
				if (isUnknown(error)) {
					controller.abort();
				}
				throw error;
			}
		} finally {
			this.authorizing.delete(controller);
			unlockMutation?.();
			if (record) {
				record.active.delete(controller);
				record.inFlight.delete(lifecycle);
				if (!record.resource.isOpen || (executing && resourceUse === 'direct' && controller.signal.aborted)) {
					void this.closeOwned(record).catch(() => undefined);
				} else if (
					resourceUse === 'dedicated_transfer' &&
					this.accepting &&
					!record.closePromise &&
					this.owners.get(id) === record
				) {
					// The transfer owns its cancellation; the healthy Workspace gets a new idle window.
					record.expiresAt = Date.now() + FILE_IDLE_MS;
				}
			}
			clearTimeout(timer);
			requestSignal?.removeEventListener('abort', abort);
			operationFinished();
		}
	}

	private async executeOwned<T>(
		record: OwnedResource,
		token: string | null,
		id: string,
		action: (resource: FileResource, remainingMs: number, signal: AbortSignal) => Promise<T>,
		signal: AbortSignal,
		started: number,
		mutation: boolean,
		timeoutMs: number,
		authorization: 'bound_session' | 'same_user_workspace' | 'download_ticket',
	): Promise<T> {
		if (mutation) {
			// Admission can precede a long mutation queue; revalidate before dispatch.
			await this.checkDelivery(record, token, id, signal, authorization);
		} else {
			await this.untilAbort(this.model.checkFingerprint(record.resource), signal);
		}
		signal.throwIfAborted();
		const result = await action(record.resource, Math.max(1, timeoutMs - (Date.now() - started)), signal);
		if (mutation) {
			await this.confirmMutation(() => this.checkDelivery(record, token, id, signal, authorization));
		} else {
			await this.checkDelivery(record, token, id, signal, authorization);
		}
		record.expiresAt = Date.now() + FILE_IDLE_MS;
		return result;
	}

	private async checkDelivery(
		record: OwnedResource,
		token: string | null,
		id: string,
		signal: AbortSignal,
		authorization: 'bound_session' | 'same_user_workspace' | 'download_ticket',
	): Promise<void> {
		signal.throwIfAborted();
		await this.untilAbort(this.model.checkFingerprint(record.resource), signal);
		signal.throwIfAborted();
		if (!this.accepting || record.closePromise || !record.resource.isOpen || this.owners.get(id) !== record) {
			throw new RemoteFileFailure('not_found');
		}
		if (
			(await this.untilAbort(this.operationIdentity(token, authorization), signal)) !== record.userId ||
			!this.accepting ||
			record.closePromise ||
			!record.resource.isOpen ||
			this.owners.get(id) !== record
		) {
			throw new RemoteFileFailure('unauthenticated');
		}
		if (authorization === 'same_user_workspace') {
			const source = await this.untilAbort(this.access.authenticateDigest(record.tokenHash), signal);
			if (!source || source.userId !== record.userId) {
				throw new RemoteFileFailure('not_found');
			}
		}
		signal.throwIfAborted();
	}

	/** A failure to confirm an applied mutation never proves that it was not applied. */
	private async confirmMutation<T>(confirmation: () => Promise<T>): Promise<T> {
		try {
			return await confirmation();
		} catch (cause) {
			throw isUnknown(cause) ? cause : new RemoteFileFailure('operation_unknown', { cause });
		}
	}

	private remaining(timeoutMs: number, signal: AbortSignal): () => number {
		const deadline = Date.now() + timeoutMs;
		return () => {
			signal.throwIfAborted();
			const value = deadline - Date.now();
			if (value < 1) {
				throw new RemoteFileFailure('remote_unavailable');
			}
			return value;
		};
	}

	private async optionalStat(
		resource: FileResource,
		filePath: string,
		followLinks: boolean,
		remaining: () => number,
		signal: AbortSignal,
	): Promise<FileInfo | null> {
		try {
			return await resource.stat({ path: filePath, followLinks, timeoutMs: remaining(), signal });
		} catch (error) {
			if (error instanceof RemoteFileFailure && error.code === 'not_found') {
				return null;
			}
			throw error;
		}
	}

	private async readHash(
		resource: FileResource,
		filePath: string,
		maxBytes: number,
		remaining: () => number,
		signal: AbortSignal,
	): Promise<string> {
		const bytes = await resource.read({ path: filePath, maxBytes, timeoutMs: remaining(), signal });
		return sha256(bytes);
	}

	private async discard(staged: FileStagedWrite, primary: unknown): Promise<never> {
		if (isUnknown(primary)) {
			throw primary;
		}
		try {
			await staged.discard();
		} catch (cleanup) {
			throw new RemoteResourceCleanupFailure([primary, cleanup]);
		}
		throw primary;
	}

	/**
	 * B2 file streaming shares the Workspace's authorized FileResource, not a
	 * second SFTP lease. Policy/Range selection precedes the HTTP response.
	 * The old downloader relied on a metadata size but did not always prove a
	 * complete body; FileResource now checks the requested byte count exactly.
	 */
	private workspaceRecord(
		token: string | null,
		workspaceId: string | null,
		targetId: number,
		authorization: 'bound_session' | 'same_user_workspace' | 'download_ticket' = 'bound_session',
	): OwnedResource {
		if (!token) {
			throw new RemoteFileFailure('unauthenticated');
		}
		const matching = [...this.owners.values()].filter(
			(item) =>
				item.workspaceId !== undefined &&
				(workspaceId === null || item.workspaceId === workspaceId) &&
				item.resource.targetId === targetId &&
				(authorization === 'same_user_workspace' || item.tokenHash === tokenHash(token)),
		);
		// Old optional sessionId selected an arbitrary active target when several
		// Workspaces shared a Connection. Reject ambiguity instead of downloading
		// from a different resource than the one the user intended.
		if (matching.length !== 1) {
			throw new RemoteFileFailure(matching.length ? 'conflict' : 'not_found');
		}
		return matching[0];
	}

	async issueDownloadTicket(
		token: string | null,
		workspaceId: string | null,
		targetId: number,
		filePath: string,
		signal?: AbortSignal,
	): Promise<{ url: string; expiresInSeconds: number }> {
		const record = this.workspaceRecord(token, workspaceId, targetId);
		const normalized = remotePath(filePath);
		const binding = await this.run<FileDownloadTicketBinding>(
			token,
			record.id,
			async (resource, ms, abort) => {
				const info = await resource.stat({ path: normalized, followLinks: true, timeoutMs: ms, signal: abort });
				if (info.kind !== 'file' || record.workspaceId === undefined) {
					throw new RemoteFileFailure('invalid_input');
				}
				// Bind the exact authorized resource, not a reusable Workspace name.
				return {
					userId: record.userId,
					sessionDigest: record.tokenHash,
					resourceId: record.id,
					workspaceId: record.workspaceId,
					connectionId: targetId,
					remotePath: normalized,
					fileSize: info.size,
					fileMtimeSeconds: Math.floor(info.modifiedAt / 1000),
				};
			},
			signal,
		);
		if (signal?.aborted) {
			throw new RemoteFileFailure('remote_unavailable');
		}
		if (
			!this.accepting ||
			record.closePromise ||
			!record.resource.isOpen ||
			this.owners.get(record.id) !== record
		) {
			throw new RemoteFileFailure('not_found');
		}
		// Register only after the read and final authorization have succeeded.
		const ticket = this.downloadTickets.issue(binding);
		return { url: '/api/v1/sftp/download?ticket=' + encodeURIComponent(ticket), expiresInSeconds: 300 };
	}

	async downloadTicket(
		ticket: string,
		sourceIp: string,
		selection: FileReadSelection,
		withBody: boolean,
		sink: FileDownloadSink<FileDownloadPlan>,
		signal?: AbortSignal,
	): Promise<void> {
		const claim = this.downloadTickets.claim(ticket, sourceIp);
		if (claim.kind !== 'ok') {
			throw new FileDownloadTicketFailure(claim.kind);
		}
		const lease = claim.claim.binding;
		const record = this.owners.get(lease.resourceId);
		try {
			if (
				!record ||
				record.workspaceId !== lease.workspaceId ||
				record.resource.targetId !== lease.connectionId ||
				record.userId !== lease.userId ||
				record.tokenHash !== lease.sessionDigest
			) {
				throw new FileDownloadTicketFailure('gone');
			}
			await this.downloadRecord(
				lease.sessionDigest,
				record,
				lease.remotePath,
				selection,
				withBody,
				{
					plan: async (plan) => {
						if (
							plan.size !== lease.fileSize ||
							Math.floor(plan.modifiedAt / 1000) !== lease.fileMtimeSeconds
						) {
							claim.claim.invalidate();
							throw new FileDownloadTicketFailure('gone');
						}
						await sink.plan(plan);
					},

					write: (bytes, abort) => sink.write(bytes, abort),

					finish: (abort) => sink.finish(abort),
				},
				signal,
				'download_ticket',
			);
			claim.claim.complete();
		} finally {
			claim.claim.release();
		}
	}

	downloadWorkspace(
		token: string | null,
		workspaceId: string | null,
		targetId: number,
		filePath: string,
		selection: FileReadSelection,
		withBody: boolean,
		sink: FileDownloadSink<FileDownloadPlan>,
		requestSignal?: AbortSignal,
	): Promise<void> {
		const normalized = remotePath(filePath);
		const record = this.workspaceRecord(token, workspaceId, targetId);
		return this.downloadRecord(token, record, normalized, selection, withBody, sink, requestSignal);
	}

	private downloadRecord(
		token: string | null,
		record: OwnedResource,
		normalized: string,
		selection: FileReadSelection,
		withBody: boolean,
		sink: FileDownloadSink<FileDownloadPlan>,
		requestSignal?: AbortSignal,
		authorization: 'bound_session' | 'download_ticket' = 'bound_session',
	): Promise<void> {
		return this.run(
			token,
			record.id,
			async (resource, ms, signal) => {
				if (this.owners.get(record.id) !== record || !record.workspaceId) {
					throw new RemoteFileFailure('not_found');
				}
				const remaining = this.remaining(ms, signal);
				const info = await resource.stat({
					path: normalized,
					followLinks: true,
					// Metadata RPCs retain the short technical timeout; the later byte
					// stream owns the separate bounded long-transfer deadline.
					timeoutMs: Math.min(remaining(), 300000),
					signal,
				});
				if (info.kind !== 'file' || !Number.isSafeInteger(info.size) || info.size < 0) {
					throw new RemoteFileFailure('invalid_input');
				}
				const range = selectDownloadRange(selection, info.size);
				const start = range?.start ?? 0;
				const end = range?.end ?? info.size - 1;
				const length = Math.max(0, end - start + 1);
				await sink.plan({
					path: normalized,
					size: info.size,
					modifiedAt: info.modifiedAt,
					partial: range !== null,
					start,
					end,
					length,
				});
				if (withBody && length > 0) {
					const reader = await resource.openRead({
						path: normalized,
						start,
						length,
						maxBytes: length,
						timeoutMs: remaining(),
						signal,
					});
					let lastIdentityCheck = Date.now();
					for await (const bytes of reader) {
						remaining();
						await sink.write(bytes, signal);
						if (Date.now() - lastIdentityCheck >= 5000) {
							// Long transfers must not retain access after revocation merely
							// because the initial GET passed cookie authorization.
							await this.untilAbort(this.operationIdentity(token, authorization), signal);
							lastIdentityCheck = Date.now();
						}
					}
				}
				await this.checkDelivery(record, token, record.id, signal, authorization);
				await sink.finish(signal);
			},
			requestSignal,
			false,
			withBody ? FILE_TRANSFER_MS : FILE_OPERATION_MS,
			authorization,
		);
	}

	/** B2 directory ZIP is a long, bounded read under the existing Workspace owner. */
	inspectDownloadKind(
		token: string | null,
		workspaceId: string | null,
		targetId: number,
		filePath: string,
		signal?: AbortSignal,
	): Promise<'file' | 'directory' | 'other'> {
		const normalized = remotePath(filePath);
		const record = this.workspaceRecord(token, workspaceId, targetId);
		return this.run(
			token,
			record.id,
			async (resource, ms, abort) => {
				const info = await resource.stat({
					path: normalized,
					followLinks: true,
					timeoutMs: Math.min(ms, 300000),
					signal: abort,
				});
				if (info.kind === 'file' || info.kind === 'directory') {
					return info.kind;
				}
				return 'other';
			},
			signal,
		);
	}

	/** B2 directory ZIP is a long, bounded read under the existing Workspace owner. */
	downloadDirectory(
		token: string | null,
		workspaceId: string | null,
		targetId: number,
		filePath: string,
		sink: FileDownloadSink<string>,
		signal?: AbortSignal,
	): Promise<void> {
		const normalized = remotePath(filePath);
		const record = this.workspaceRecord(token, workspaceId, targetId);
		return this.run(
			token,
			record.id,
			async (resource, ms, abort) => {
				let lastIdentityCheck = Date.now();
				await streamRemoteDirectoryZip(
					resource,
					normalized,
					this.remaining(ms, abort),
					abort,
					(filename) => sink.plan(filename),
					async (bytes, signal) => {
						if (Date.now() - lastIdentityCheck >= 5000) {
							await this.untilAbort(this.identity(token), signal);
							lastIdentityCheck = Date.now();
						}
						await sink.write(bytes, signal);
					},
				);
				await this.checkDelivery(record, token, record.id, abort, 'bound_session');
				await sink.finish(abort);
			},
			signal,
			false,
			FILE_TRANSFER_MS,
		);
	}

	private uploadKey(workspaceId: string, id: string): string {
		return workspaceId + '\0' + id;
	}

	private requireTransferCapacity(workspaceId: string): void {
		const tasks = [...this.uploads.values(), ...this.copyMoves.values(), ...this.archives.values()];
		const active = tasks.filter((task) => task.workspaceId === workspaceId).length;
		const preparing = [...this.preparingUploads.values()].filter(
			(owner) => owner.workspaceId === workspaceId,
		).length;
		if (active + preparing >= MAX_WORKSPACE_TRANSFERS) {
			throw new RemoteFileFailure('limit_exceeded');
		}
	}

	/** Prepare only paths inside the chosen Workspace base; no remote symlink traversal. */
	prepareUpload(
		token: string | null,
		workspaceId: string,
		prepareId: string,
		basePath: string,
		directories: readonly string[],
		signal?: AbortSignal,
	): Promise<{ preparedDirectories: number }> {
		if (
			!prepareId ||
			prepareId.length > 512 ||
			!Array.isArray(directories) ||
			directories.length > WORKSPACE_UPLOAD_MAX_PREPARE_DIRECTORIES
		) {
			throw new RemoteFileFailure('invalid_input');
		}
		const root = remoteTransferPath(basePath);
		const paths = new Set<string>([root]);
		for (const item of directories) {
			if (typeof item !== 'string' || item.includes('\0') || path.posix.isAbsolute(item)) {
				throw new RemoteFileFailure('invalid_input');
			}
			const full = remoteTransferPath(path.posix.resolve(root, item));
			if (full !== root && !full.startsWith(root.endsWith('/') ? root : root + '/')) {
				throw new RemoteFileFailure('invalid_input');
			}
			paths.add(full);
		}
		const record = this.workspaceRecord(token, workspaceId, this.workspaceTargetId(workspaceId));
		const preparationKey = this.uploadKey(workspaceId, prepareId);
		if (this.preparingUploads.has(preparationKey)) {
			throw new RemoteFileFailure('conflict');
		}
		this.requireTransferCapacity(workspaceId);
		this.preparingUploads.set(preparationKey, { workspaceId, ownerId: record.id });
		return this.run(
			token,
			record.id,
			async (resource, ms, abort) => {
				for (const [key, prepared] of this.preparedUploads) {
					if (prepared.expiresAt <= Date.now()) {
						this.preparedUploads.delete(key);
					}
				}
				const ownerBatches = [...this.preparedUploads.entries()].filter(
					([, item]) => item.workspaceId === workspaceId && item.ownerId === record.id,
				);
				const existing = this.preparedUploads.get(this.uploadKey(workspaceId, prepareId));
				const totalPrepared = ownerBatches.reduce((sum, [, item]) => sum + item.directories.size, 0);
				if (
					(!existing && ownerBatches.length >= 64) ||
					totalPrepared - (existing?.directories.size ?? 0) + paths.size > 100_000
				) {
					throw new RemoteFileFailure('limit_exceeded');
				}
				const remaining = this.remaining(ms, abort);
				let changed = false;
				try {
					for (const filePath of [...paths].sort((a, b) => a.length - b.length)) {
						await this.ensureRemoteDirectory(resource, filePath, remaining, abort, () => {
							changed = true;
						});
					}
					abort.throwIfAborted();
					if (!this.accepting || record.closePromise || this.owners.get(record.id) !== record) {
						throw new RemoteFileFailure('not_found');
					}
				} catch (cause) {
					throw changed && !isUnknown(cause) ? new RemoteFileFailure('operation_unknown', { cause }) : cause;
				}
				const key = this.uploadKey(workspaceId, prepareId);
				this.preparedUploads.set(key, {
					workspaceId,
					ownerId: record.id,
					root,
					directories: paths,
					expiresAt: Date.now() + 30 * 60 * 1000,
				});
				return { preparedDirectories: paths.size };
			},
			signal,
			true,
			FILE_TRANSFER_MS,
		).finally(() => {
			if (this.preparingUploads.get(preparationKey)?.ownerId === record.id) {
				this.preparingUploads.delete(preparationKey);
			}
		});
	}

	private workspaceTargetId(workspaceId: string): number {
		const record = [...this.owners.values()].find((item) => item.workspaceId === workspaceId);
		if (!record) {
			throw new RemoteFileFailure('not_found');
		}
		return record.resource.targetId;
	}

	private async ensureRemoteDirectory(
		resource: FileResource,
		filePath: string,
		remaining: () => number,
		signal: AbortSignal,
		onMutation?: () => void,
	): Promise<void> {
		const parts = filePath.split('/').filter(Boolean);
		let current = '/';
		for (const name of parts) {
			current = path.posix.join(current, name);
			const info = await this.optionalStat(resource, current, false, remaining, signal);
			if (info === null) {
				await resource.mkdir({ path: current, timeoutMs: Math.min(remaining(), 300000), signal });
				onMutation?.();
			} else if (info.kind !== 'directory') {
				throw new RemoteFileFailure('conflict');
			}
		}
	}

	/**
	 * An upload uses a dedicated SSH/SFTP resource. The old transfer path could
	 * let cancellation of a write retire a live Workspace lease; that should
	 * not interrupt unrelated Files requests or the terminal owner.
	 */
	private async withUploadResource<T>(
		workspace: FileResource,
		timeoutMs: number,
		signal: AbortSignal,
		owner: TransferResourceOwner,
		action: (transfer: FileResource) => Promise<T>,
	): Promise<T> {
		let transfer: FileResource;
		try {
			transfer = await this.model.open(workspace.targetId, Math.min(timeoutMs, 30000), signal);
		} catch (error) {
			if (error instanceof RemoteResourceCleanupFailure) {
				this.rememberTransferCleanup(owner, error);
			}
			throw error;
		}
		let primary: unknown = null;
		try {
			if (transfer.fingerprint !== workspace.fingerprint) {
				throw new RemoteFileFailure('stale_target');
			}
			return await action(transfer);
		} catch (error) {
			primary = error;
			if (error instanceof RemoteResourceCleanupFailure) {
				// Stage/archive cleanup can fail even if the connection closes successfully.
				this.rememberTransferCleanup(owner, error);
			}
			throw error;
		} finally {
			try {
				await transfer.close();
			} catch (cleanup) {
				const failure = new RemoteResourceCleanupFailure(primary === null ? [cleanup] : [primary, cleanup]);
				this.rememberTransferCleanup(owner, failure);
				throw failure;
			}
		}
	}

	private rememberTransferCleanup(owner: TransferResourceOwner, failure: RemoteResourceCleanupFailure): void {
		if (owner.cleanupFailure === failure) {
			return;
		}
		this.cleanupFailures.record(failure);
		for (const ownerId of owner.cleanupOwnerIds) {
			const previous = this.transferCleanupByOwner.get(ownerId);
			this.transferCleanupByOwner.set(
				ownerId,
				previous === undefined ? failure : new RemoteResourceCleanupFailure([previous, failure]),
			);
		}
		owner.cleanupFailure =
			owner.cleanupFailure && !failure.errors.includes(owner.cleanupFailure)
				? new RemoteResourceCleanupFailure([owner.cleanupFailure, failure])
				: failure;
	}

	startUpload(
		token: string | null,
		workspaceId: string,
		input: FileUploadStart,
		emit: (event: FileUploadEvent) => void,
	): { started: true } {
		if (
			!token ||
			!input.uploadId ||
			input.uploadId.length > 512 ||
			!Number.isSafeInteger(input.size) ||
			input.size < 0 ||
			!['ask', 'overwrite', 'skip'].includes(input.conflictPolicy)
		) {
			throw new RemoteFileFailure('invalid_input');
		}
		const destination = remoteTransferPath(input.destinationPath, true);
		const record = this.workspaceRecord(token, workspaceId, this.workspaceTargetId(workspaceId));
		const key = this.uploadKey(workspaceId, input.uploadId);
		if (this.uploads.has(key) || this.copyMoves.has(key) || this.archives.has(key)) {
			throw new RemoteFileFailure('conflict');
		}
		this.requireTransferCapacity(workspaceId);
		let complete!: () => void;
		let fail!: (cause: unknown) => void;
		const completion = new Promise<void>((resolve, reject) => {
			complete = resolve;
			fail = reject;
		});
		void completion.catch(() => undefined);
		const task: RunningUpload = {
			finished: false,
			cleanupFailure: null,
			cleanupOwnerIds: [record.id],
			workspaceId,
			ownerId: record.id,
			uploadId: input.uploadId,
			tokenHash: tokenHash(token),
			path: destination,
			size: input.size,
			accepted: 0,
			nextIndex: 0,
			controller: new AbortController(),
			stage: null,
			queue: Promise.resolve(),
			completion,
			terminal: false,
			cancelled: false,
			mutationStarted: false,
			streamAttached: false,
			complete,
			fail,
			emit,
		};
		this.uploads.set(key, task);
		const operation = this.run(
			token,
			record.id,
			async (workspace, ms, abort) =>
				this.withUploadResource(workspace, ms, abort, task, async (resource) => {
					const remaining = this.remaining(ms, abort);
					const existing = await this.optionalStat(resource, destination, false, remaining, abort);
					if (existing !== null && existing.kind !== 'file') {
						throw new RemoteFileFailure('conflict');
					}
					if (existing !== null && input.conflictPolicy !== 'overwrite') {
						task.terminal = true;
						return { kind: input.conflictPolicy === 'skip' ? ('skipped' as const) : ('conflict' as const) };
					}
					if (input.prepareId) {
						const prepared = this.preparedUploads.get(this.uploadKey(workspaceId, input.prepareId));
						if (
							!prepared ||
							prepared.ownerId !== record.id ||
							prepared.expiresAt <= Date.now() ||
							!prepared.directories.has(path.posix.dirname(destination))
						) {
							throw new RemoteFileFailure('conflict');
						}
						if (input.relativePath !== undefined) {
							const relative = input.relativePath;
							if (
								!relative ||
								relative.includes('\0') ||
								path.posix.isAbsolute(relative) ||
								path.posix.resolve(prepared.root, relative) !== destination
							) {
								// The old upload prepare flow trusted the separately supplied
								// destination and relative path without proving they referred
								// to the same prepared file. Fail rather than write elsewhere.
								throw new RemoteFileFailure('invalid_input');
							}
						}
					}
					// A prepare record is an allowlist, not proof that its directories are still safe.
					await this.ensureRemoteDirectory(
						resource,
						path.posix.dirname(destination),
						remaining,
						abort,
						() => {
							task.mutationStarted = true;
						},
					);
					const stage = await resource.openUploadStage({
						path: destination,
						mode: existing === null ? undefined : existing.mode & 0o7777,
						timeoutMs: remaining(),
						signal: abort,
					});
					task.stage = stage;

					const stop = () => task.fail(new RemoteFileFailure('operation_unknown'));

					abort.addEventListener('abort', stop, { once: true });
					if (abort.aborted) {
						stop();
					}
					try {
						const renewIdle = () => {
							clearTimeout(task.idleTimer);
							task.idleTimer = setTimeout(() => {
								task.fail(new RemoteFileFailure('remote_unavailable'));
								task.controller.abort();
							}, FILE_UPLOAD_IDLE_MS);
							task.idleTimer.unref();
						};

						if (!abort.aborted) {
							renewIdle();
						}
						if (!abort.aborted && task.size === 0) {
							// Old frontend deliberately never opens /ws/uploads for an empty
							// file. Commit the empty temp without a synthetic final frame.
							task.terminal = true;
							task.complete();
						} else if (!abort.aborted) {
							task.emit({ type: 'ready', uploadId: task.uploadId });
						}
						await task.completion;
						await task.queue;
						abort.throwIfAborted();
						task.mutationStarted = true;
						await stage.commit(existing === null ? 'create' : 'replace');
						try {
							const info = await resource.stat({
								path: destination,
								followLinks: false,
								timeoutMs: Math.min(remaining(), 300000),
								signal: abort,
							});
							if (info.kind !== 'file' || info.size !== input.size) {
								throw new RemoteFileFailure('operation_unknown');
							}
							return { kind: 'completed' as const, info };
						} catch (cause) {
							throw new RemoteFileFailure('operation_unknown', { cause });
						}
					} catch (error) {
						try {
							await stage.discard();
						} catch (cleanup) {
							throw new RemoteResourceCleanupFailure([error, cleanup]);
						}
						throw error;
					} finally {
						clearTimeout(task.idleTimer);
						abort.removeEventListener('abort', stop);
					}
				}),
			task.controller.signal,
			true,
			FILE_TRANSFER_MS,
			'bound_session',
			'dedicated_transfer',
		)
			.then(
				(result) => {
					if (result.kind === 'conflict') {
						task.emit({
							type: 'conflict',
							uploadId: task.uploadId,
							destinationPath: destination,
							filename: path.posix.basename(destination),
						});
					} else if (result.kind === 'skipped') {
						task.emit({ type: 'skipped', uploadId: task.uploadId, destinationPath: destination });
					} else if (result.kind === 'completed' && result.info) {
						task.emit({
							type: 'completed',
							uploadId: task.uploadId,
							destinationPath: destination,
							item: { path: destination, name: path.posix.basename(destination), info: result.info },
						});
					}
				},
				(error: unknown) => {
					const unknown = task.mutationStarted || isUnknown(error);
					task.emit(
						task.cancelled && !unknown
							? { type: 'cancelled', uploadId: task.uploadId }
							: {
									type: 'failed',
									uploadId: task.uploadId,
									message: unknown
										? 'operation_unknown'
										: error instanceof RemoteFileFailure
											? error.code
											: 'remote_unavailable',
								},
					);
				},
			)
			.finally(() => {
				task.finished = true;
				if (this.uploads.get(key) === task && task.cleanupFailure === null) {
					this.uploads.delete(key);
				}
			});
		void operation.catch(() => undefined);
		return { started: true };
	}

	private async appendUpload(token: string, task: RunningUpload, bytes: Uint8Array): Promise<boolean> {
		const key = this.uploadKey(task.workspaceId, task.uploadId);
		if (
			this.uploads.get(key) !== task ||
			task.finished ||
			tokenHash(token) !== task.tokenHash ||
			task.cancelled ||
			task.terminal
		) {
			throw new RemoteFileFailure('not_found');
		}
		await this.identity(token);
		if (this.uploads.get(key) !== task || task.finished) {
			throw new RemoteFileFailure('not_found');
		}
		if (bytes.byteLength > WORKSPACE_UPLOAD_MAX_CHUNK_BYTES) {
			throw new RemoteFileFailure('limit_exceeded');
		}
		const append = task.queue.then(async () => {
			if (this.uploads.get(key) !== task || task.finished || !task.stage || task.cancelled || task.terminal) {
				throw new RemoteFileFailure('remote_unavailable');
			}
			const next = task.accepted + bytes.byteLength;
			if (!Number.isSafeInteger(next) || next > task.size) {
				throw new RemoteFileFailure('invalid_input');
			}
			const chunkIndex = task.nextIndex++;
			await task.stage.append(bytes);
			if (
				this.uploads.get(key) !== task ||
				task.finished ||
				task.cancelled ||
				task.terminal ||
				task.controller.signal.aborted
			) {
				throw new RemoteFileFailure('operation_unknown');
			}
			clearTimeout(task.idleTimer);
			task.idleTimer = setTimeout(() => {
				task.fail(new RemoteFileFailure('remote_unavailable'));
				task.controller.abort();
			}, FILE_UPLOAD_IDLE_MS);
			task.idleTimer.unref();
			task.accepted = next;
			task.emit({
				type: 'progress',
				uploadId: task.uploadId,
				chunkIndex,
				bytesWritten: next,
				totalSize: task.size,
				progress: task.size === 0 ? 100 : Math.min(100, Math.round((next / task.size) * 100)),
			});
			if (next === task.size) {
				task.terminal = true;
				task.complete();
			}
			return next === task.size;
		});
		task.queue = append.then(
			() => undefined,
			(error: unknown) => {
				task.fail(error);
			},
		);
		return append;
	}

	claimUploadStream(
		token: string | null,
		workspaceId: string,
		uploadId: string,
		size: number,
	): FileUploadStreamAttachment | null {
		const task = this.uploads.get(this.uploadKey(workspaceId, uploadId));
		if (
			!task ||
			task.finished ||
			!token ||
			tokenHash(token) !== task.tokenHash ||
			task.size !== size ||
			!task.stage ||
			task.terminal ||
			task.streamAttached ||
			task.cancelled
		) {
			return null;
		}
		task.streamAttached = true;
		return {
			append: (bytes) => this.appendUpload(token, task, bytes),

			abort: () => {
				if (this.uploads.get(this.uploadKey(workspaceId, uploadId)) !== task || task.finished) {
					return;
				}
				task.fail(new RemoteFileFailure('operation_unknown'));
				task.controller.abort();
			},
		};
	}

	cancelUpload(token: string | null, workspaceId: string, uploadId: string): Promise<boolean> {
		return this.finishUpload(token, workspaceId, uploadId);
	}

	abortUpload(token: string | null, workspaceId: string, uploadId: string): Promise<boolean> {
		return this.finishUpload(token, workspaceId, uploadId, 'abort');
	}

	private async finishUpload(
		token: string | null,
		workspaceId: string,
		uploadId: string,
		mode: 'cancel' | 'abort' = 'cancel',
	): Promise<boolean> {
		const key = this.uploadKey(workspaceId, uploadId);
		const task = this.uploads.get(key);
		if (!task || task.finished) {
			return false;
		}
		if (!token || tokenHash(token) !== task.tokenHash) {
			throw new RemoteFileFailure('not_found');
		}
		await this.identity(token);
		if (this.uploads.get(key) !== task || task.finished) {
			return false;
		}
		task.cancelled = mode === 'cancel';
		task.fail(new RemoteFileFailure('operation_unknown'));
		task.controller.abort();
		return true;
	}

	startCopyMove(
		token: string | null,
		workspaceId: string,
		requestId: string,
		mode: 'copy' | 'move',
		sourcePaths: readonly string[],
		destination: string,
		sourceWorkspaceId: string | undefined,
		emit: (event: FileCopyMoveEvent) => void,
	): { started: true } {
		if (
			!token ||
			!requestId ||
			requestId.length > 512 ||
			!['copy', 'move'].includes(mode) ||
			!Array.isArray(sourcePaths) ||
			sourcePaths.length < 1 ||
			sourcePaths.length > WORKSPACE_TRANSFER_MAX_SOURCES
		) {
			throw new RemoteFileFailure('invalid_input');
		}
		const paths = sourcePaths.map((value) => remoteTransferPath(value, true));
		const destinationDirectory = remoteTransferPath(destination);
		const sourceId = sourceWorkspaceId ?? workspaceId;
		const sourceRecord = this.workspaceRecord(
			token,
			sourceId,
			this.workspaceTargetId(sourceId),
			'same_user_workspace',
		);
		const destinationRecord = this.workspaceRecord(token, workspaceId, this.workspaceTargetId(workspaceId));
		const key = this.uploadKey(workspaceId, requestId);
		if (this.copyMoves.has(key) || this.uploads.has(key) || this.archives.has(key)) {
			throw new RemoteFileFailure('conflict');
		}
		this.requireTransferCapacity(workspaceId);
		const task: RunningCopyMove = {
			finished: false,
			cleanupFailure: null,
			cleanupOwnerIds: [...new Set([destinationRecord.id, sourceRecord.id])],
			workspaceId,
			ownerId: destinationRecord.id,
			sourceWorkspaceId: sourceId,
			sourceOwnerId: sourceRecord.id,
			requestId,
			tokenHash: tokenHash(token),
			controller: new AbortController(),
			cancelled: false,
			emit,
		};
		this.copyMoves.set(key, task);
		let dispatchedMutation = false;
		const pending = this.run(
			token,
			destinationRecord.id,
			async (destinationOwner, destinationMs, signal) => {
				return this.run(
					token,
					sourceRecord.id,
					async (sourceOwner, sourceMs, sourceSignal) => {
						const budget = Math.min(sourceMs, destinationMs);
						return this.withUploadResource(sourceOwner, budget, sourceSignal, task, async (source) =>
							this.withUploadResource(
								destinationOwner,
								budget,
								sourceSignal,
								task,
								async (destinationResource) => {
									const remaining = this.remaining(budget, sourceSignal);
									return copyRemoteEntries(
										source,
										destinationResource,
										paths,
										destinationDirectory,
										mode,
										remaining,
										sourceSignal,
										(progress) =>
											emit({
												type: 'progress',
												requestId,
												transferredBytes: progress.transferredBytes,
												totalBytes: progress.transferredBytes,
												completedFiles: progress.completedFiles,
												totalFiles: paths.length,
												totalKnown: false,
												currentFile: progress.currentFile,
											}),
										() => {
											dispatchedMutation = true;
										},
									);
								},
							),
						);
					},
					signal,
					false,
					FILE_TRANSFER_MS,
					'same_user_workspace',
					'dedicated_transfer',
				);
			},
			task.controller.signal,
			true,
			FILE_TRANSFER_MS,
			'bound_session',
			'dedicated_transfer',
		)
			.then(
				(result) => {
					emit({
						type: 'completed',
						requestId,
						mode,
						sourcePaths: paths,
						destinationPath: destinationDirectory,
						items: result.items,
						crossSession: sourceId !== workspaceId,
						sourceOwnerId: sourceId === workspaceId ? undefined : sourceId,
					});
				},
				(cause: unknown) => {
					const unknown = dispatchedMutation || isUnknown(cause);
					if (task.cancelled && !unknown) {
						emit({ type: 'cancelled', requestId });
					} else {
						emit({
							type: 'failed',
							requestId,
							mode,
							message: unknown
								? 'operation_unknown'
								: cause instanceof RemoteFileFailure
									? cause.code
									: 'remote_unavailable',
						});
					}
				},
			)
			.finally(() => {
				task.finished = true;
				if (this.copyMoves.get(key) === task && task.cleanupFailure === null) {
					this.copyMoves.delete(key);
				}
			});
		void pending.catch(() => undefined);
		return { started: true };
	}

	async cancelCopyMove(token: string | null, workspaceId: string, requestId: string): Promise<boolean> {
		const key = this.uploadKey(workspaceId, requestId);
		const task = this.copyMoves.get(key);
		if (!task || task.finished) {
			return false;
		}
		if (!token || task.tokenHash !== tokenHash(token)) {
			throw new RemoteFileFailure('not_found');
		}
		await this.identity(token);
		if (this.copyMoves.get(key) !== task || task.finished) {
			return false;
		}
		if (task.cancelled) {
			return true;
		}
		task.cancelled = true;
		task.emit({ type: 'cancelling', requestId });
		task.controller.abort();
		return true;
	}

	startArchive(
		token: string | null,
		workspaceId: string,
		requestId: string,
		input: FileArchiveRequest,
		emit: (event: FileArchiveEvent) => void,
	): { started: true } {
		if (!token || !requestId || requestId.length > 512) {
			throw new RemoteFileFailure('invalid_input');
		}
		const record = this.workspaceRecord(token, workspaceId, this.workspaceTargetId(workspaceId));
		const key = this.uploadKey(workspaceId, requestId);
		if (this.archives.has(key) || this.copyMoves.has(key) || this.uploads.has(key)) {
			throw new RemoteFileFailure('conflict');
		}
		this.requireTransferCapacity(workspaceId);
		const operation = input.kind;
		const task: RunningArchive = {
			finished: false,
			cleanupFailure: null,
			cleanupOwnerIds: [record.id],
			workspaceId,
			ownerId: record.id,
			requestId,
			tokenHash: tokenHash(token),
			controller: new AbortController(),
			cancelled: false,
			mutationStarted: false,
			operation,
		};
		this.archives.set(key, task);
		const pending = this.run(
			token,
			record.id,
			async (workspace, ms, signal) => {
				const remaining = this.remaining(ms, signal);
				if (input.password !== undefined) {
					if (!input.password || /[\0\r\n]/u.test(input.password) || !isWellFormedFileText(input.password)) {
						throw new ArchiveRejection('INVALID_PASSWORD_FORMAT');
					}
					if ([...input.password].length > WORKSPACE_ARCHIVE_MAX_PASSWORD_CODE_POINTS) {
						throw new ArchiveRejection('PASSWORD_TOO_LONG');
					}
				}
				const archivePath =
					input.kind === 'compress'
						? remoteTransferPath(input.destination, true)
						: remoteTransferPath(input.source, true);
				const format: ArchiveFormat | null =
					input.kind === 'compress'
						? input.format
						: archivePath.toLowerCase().endsWith('.zip')
							? 'zip'
							: /\.(tar\.gz|tgz)$/u.test(archivePath.toLowerCase())
								? 'tar.gz'
								: /\.(tar\.bz2|tbz2)$/u.test(archivePath.toLowerCase())
									? 'tar.bz2'
									: null;
				if (format === null) {
					throw new ArchiveRejection('UNSUPPORTED_FORMAT');
				}
				if (input.password !== undefined && format !== 'zip') {
					throw new ArchiveRejection('UNSUPPORTED_FORMAT');
				}
				const sources =
					input.kind === 'compress' ? input.sources.map((source) => remoteTransferPath(source, true)) : [];
				if (input.kind === 'compress' && (!sources.length || sources.length > WORKSPACE_TRANSFER_MAX_SOURCES)) {
					throw new RemoteFileFailure('invalid_input');
				}
				let warning: string | undefined;
				const amount = await this.withUploadResource(workspace, ms, signal, task, async (resource) => {
					emit({ type: 'progress', operation, requestId, fileCount: 0, percent: 0 });

					const onMutation = () => {
						task.mutationStarted = true;
					};

					const onProgress = (fileCount: number) => {
						emit({ type: 'progress', operation, requestId, fileCount });
					};

					return input.kind === 'compress'
						? compressRemoteArchive(
								resource,
								sources,
								archivePath,
								format,
								remaining,
								signal,
								onMutation,
								onProgress,
								(value) => {
									warning = value;
								},
								input.password,
							)
						: decompressRemoteArchive(
								resource,
								archivePath,
								format,
								remaining,
								signal,
								onMutation,
								onProgress,
								input.password,
							);
				});
				return { amount, archivePath, operation, warning };
			},
			task.controller.signal,
			true,
			FILE_TRANSFER_MS,
			'bound_session',
			'dedicated_transfer',
		)
			.then(
				(result) => {
					emit({
						type: 'progress',
						operation,
						requestId,
						fileCount: result.amount,
						totalFiles: result.amount,
						percent: 100,
					});
					emit({
						type: 'completed',
						operation,
						requestId,
						path: operation === 'compress' ? result.archivePath : path.posix.dirname(result.archivePath),
						warning: result.warning,
					});
				},
				(cause: unknown) => {
					if (
						task.cancelled &&
						!isUnknown(cause) &&
						(!task.mutationStarted || cause instanceof FileCommandNotStarted)
					) {
						emit({ type: 'cancelled', operation, requestId });
						return;
					}
					if (cause instanceof ArchiveRejection) {
						emit({
							type: 'failed',
							operation,
							requestId,
							message: cause.code,
							code: cause.code,
							commandNotFound: cause.commandNotFound,
						});
						return;
					}
					emit({
						type: 'failed',
						operation,
						requestId,
						message:
							task.mutationStarted || isUnknown(cause)
								? 'operation_unknown'
								: cause instanceof RemoteFileFailure
									? cause.code
									: 'remote_unavailable',
					});
				},
			)
			.finally(() => {
				task.finished = true;
				if (this.archives.get(key) === task && task.cleanupFailure === null) {
					this.archives.delete(key);
				}
			});
		void pending.catch(() => undefined);
		return { started: true };
	}

	async cancelArchive(token: string | null, workspaceId: string, requestId: string): Promise<boolean> {
		const key = this.uploadKey(workspaceId, requestId);
		const task = this.archives.get(key);
		if (!task || task.finished) {
			return false;
		}
		if (!token || tokenHash(token) !== task.tokenHash) {
			throw new RemoteFileFailure('not_found');
		}
		await this.identity(token);
		if (this.archives.get(key) !== task || task.finished) {
			return false;
		}
		if (task.cancelled) {
			return true;
		}
		task.cancelled = true;
		task.controller.abort();
		return true;
	}

	list(
		token: string | null,
		id: string,
		filePath: string,
		maxEntries: number,
		maxMetadataBytes: number,
		signal?: AbortSignal,
	): Promise<FileEntry[]> {
		const normalized = remotePath(filePath);
		return this.run(
			token,
			id,
			async (resource, ms, abort) =>
				sortEntries(
					await resource.list({
						path: normalized,
						timeoutMs: ms,
						signal: abort,
						maxEntries,
						maxMetadataBytes,
					}),
				),
			signal,
		);
	}

	stat(token: string | null, id: string, filePath: string, follow: boolean, signal?: AbortSignal): Promise<FileInfo> {
		const normalized = remotePath(filePath);
		return this.run(
			token,
			id,
			(resource, ms, abort) =>
				resource.stat({ path: normalized, followLinks: follow, timeoutMs: ms, signal: abort }),
			signal,
		);
	}

	readText(
		token: string | null,
		id: string,
		filePath: string,
		maxBytes: number,
		signal?: AbortSignal,
	): Promise<TextRead> {
		const normalized = remotePath(filePath);
		if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > REMOTE_FILE_MAX_TEXT_BYTES) {
			throw new RemoteFileFailure('invalid_input');
		}
		return this.run(
			token,
			id,
			async (resource, ms, abort) => {
				const remaining = this.remaining(ms, abort);
				const info = await resource.stat({
					path: normalized,
					followLinks: false,
					timeoutMs: remaining(),
					signal: abort,
				});
				if (info.kind !== 'file') {
					throw new RemoteFileFailure('not_text');
				}
				if (info.size > maxBytes) {
					throw new RemoteFileFailure('limit_exceeded');
				}
				const bytes = await resource.read({
					path: normalized,
					maxBytes,
					timeoutMs: remaining(),
					signal: abort,
				});
				let text: string;
				try {
					text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
				} catch {
					throw new RemoteFileFailure('not_text');
				}
				if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) {
					throw new RemoteFileFailure('not_text');
				}
				return { text, bytes: bytes.byteLength, sha256: sha256(bytes), info };
			},
			signal,
		);
	}

	writeText(
		token: string | null,
		id: string,
		filePath: string,
		text: string,
		expectedSha256: string | null,
		maxBytes: number,
		signal?: AbortSignal,
	): Promise<TextWrite> {
		const normalized = remotePath(filePath, true);
		const bytes = Uint8Array.from(Buffer.from(text, 'utf8'));
		if (
			!Number.isSafeInteger(maxBytes) ||
			maxBytes < 0 ||
			maxBytes > REMOTE_FILE_MAX_TEXT_BYTES ||
			bytes.byteLength > maxBytes ||
			/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text) ||
			(expectedSha256 !== null && !/^[a-f0-9]{64}$/u.test(expectedSha256))
		) {
			throw new RemoteFileFailure('invalid_input');
		}
		return this.run(
			token,
			id,
			async (resource, ms, abort) => {
				const remaining = this.remaining(ms, abort);
				const before = await this.optionalStat(resource, normalized, false, remaining, abort);
				if (before !== null && before.kind !== 'file') {
					throw new RemoteFileFailure('conflict');
				}
				if ((before === null) !== (expectedSha256 === null)) {
					throw new RemoteFileFailure('conflict');
				}
				if (
					before !== null &&
					(await this.readHash(resource, normalized, maxBytes, remaining, abort)) !== expectedSha256
				) {
					throw new RemoteFileFailure('conflict');
				}
				const staged = await resource.stage({
					path: normalized,
					bytes,
					mode: before === null ? 0o600 : before.mode & 0o7777,
					timeoutMs: remaining(),
					signal: abort,
				});
				let committed = false;
				try {
					const current = await this.optionalStat(resource, normalized, false, remaining, abort);
					if ((current === null) !== (expectedSha256 === null)) {
						throw new RemoteFileFailure('conflict');
					}
					if (
						current !== null &&
						(current.kind !== 'file' ||
							(await this.readHash(resource, normalized, maxBytes, remaining, abort)) !== expectedSha256)
					) {
						throw new RemoteFileFailure('conflict');
					}
					await staged.commit(expectedSha256 === null ? 'create' : 'replace');
					committed = true;
					return await this.confirmMutation(async () => {
						const after = await resource.stat({
							path: normalized,
							followLinks: false,
							timeoutMs: remaining(),
							signal: abort,
						});
						if (after.kind !== 'file' || after.size !== bytes.byteLength) {
							throw new RemoteFileFailure('operation_unknown');
						}
						const afterHash = await this.readHash(resource, normalized, maxBytes, remaining, abort);
						if (afterHash !== sha256(bytes)) {
							throw new RemoteFileFailure('operation_unknown');
						}
						return {
							status: before === null ? 'created' : 'replaced',
							bytes: bytes.byteLength,
							sha256: afterHash,
							info: after,
						};
					});
				} catch (error) {
					if (!committed) {
						return await this.discard(staged, error);
					}
					throw error;
				}
			},
			signal,
			true,
		);
	}

	rename(
		token: string | null,
		id: string,
		from: string,
		to: string,
		signal?: AbortSignal,
	): Promise<FileRenameResult> {
		const sourcePath = remotePath(from, true);
		const destinationPath = remotePath(to, true);
		if (sourcePath === destinationPath) {
			throw new RemoteFileFailure('conflict');
		}
		return this.run(
			token,
			id,
			async (resource, ms, abort) => {
				const remaining = this.remaining(ms, abort);
				const source = await this.optionalStat(resource, sourcePath, false, remaining, abort);
				if (source === null) {
					throw new RemoteFileFailure('not_found');
				}
				if (source.kind === 'other') {
					throw new RemoteFileFailure('conflict');
				}
				if ((await this.optionalStat(resource, destinationPath, false, remaining, abort)) !== null) {
					throw new RemoteFileFailure('conflict');
				}
				const kind = source.kind;
				await resource.rename({
					from: sourcePath,
					to: destinationPath,
					timeoutMs: remaining(),
					signal: abort,
				});
				return await this.confirmMutation(async () => {
					const [sourceAfter, destinationAfter] = await Promise.all([
						this.optionalStat(resource, sourcePath, false, remaining, abort),
						this.optionalStat(resource, destinationPath, false, remaining, abort),
					]);
					if (sourceAfter !== null || destinationAfter?.kind !== kind) {
						throw new RemoteFileFailure('operation_unknown');
					}
					return { from: sourcePath, to: destinationPath, kind };
				});
			},
			signal,
			true,
		);
	}

	remove(token: string | null, id: string, filePath: string, signal?: AbortSignal): Promise<FileRemoveResult> {
		const normalized = remotePath(filePath, true);
		return this.run(
			token,
			id,
			async (resource, ms, abort) => {
				const remaining = this.remaining(ms, abort);
				const before = await this.optionalStat(resource, normalized, false, remaining, abort);
				if (before === null) {
					throw new RemoteFileFailure('not_found');
				}
				if (before.kind !== 'file' && before.kind !== 'symlink') {
					throw new RemoteFileFailure('conflict');
				}
				const kind = before.kind;
				await resource.remove({ path: normalized, timeoutMs: remaining(), signal: abort });
				return await this.confirmMutation(async () => {
					if ((await this.optionalStat(resource, normalized, false, remaining, abort)) !== null) {
						throw new RemoteFileFailure('operation_unknown');
					}
					return { path: normalized, kind };
				});
			},
			signal,
			true,
		);
	}

	mkdir(token: string | null, id: string, filePath: string, signal?: AbortSignal): Promise<FileDirectoryResult> {
		const normalized = remotePath(filePath, true);
		return this.run(
			token,
			id,
			async (resource, ms, abort) => {
				const remaining = this.remaining(ms, abort);
				if ((await this.optionalStat(resource, normalized, false, remaining, abort)) !== null) {
					throw new RemoteFileFailure('conflict');
				}
				await resource.mkdir({ path: normalized, timeoutMs: remaining(), signal: abort });
				return await this.confirmMutation(async () => {
					const after = await this.optionalStat(resource, normalized, false, remaining, abort);
					if (after?.kind !== 'directory') {
						throw new RemoteFileFailure('operation_unknown');
					}
					return { path: normalized };
				});
			},
			signal,
			true,
		);
	}

	rmdir(token: string | null, id: string, filePath: string, signal?: AbortSignal): Promise<FileDirectoryResult> {
		const normalized = remotePath(filePath, true);
		return this.run(
			token,
			id,
			async (resource, ms, abort) => {
				const remaining = this.remaining(ms, abort);
				const before = await this.optionalStat(resource, normalized, false, remaining, abort);
				if (before === null) {
					throw new RemoteFileFailure('not_found');
				}
				if (before.kind !== 'directory') {
					throw new RemoteFileFailure('conflict');
				}
				await resource.rmdir({ path: normalized, timeoutMs: remaining(), signal: abort });
				return await this.confirmMutation(async () => {
					if ((await this.optionalStat(resource, normalized, false, remaining, abort)) !== null) {
						throw new RemoteFileFailure('operation_unknown');
					}
					return { path: normalized };
				});
			},
			signal,
			true,
		);
	}

	initialize(token: string | null, id: string, signal?: AbortSignal): Promise<void> {
		return this.run(
			token,
			id,
			async (resource, ms, abort) => {
				await resource.realpath({ path: '.', timeoutMs: ms, signal: abort });
			},
			signal,
		);
	}

	listDirectory(token: string | null, id: string, filePath: string, signal?: AbortSignal): Promise<FilePathEntry[]> {
		const normalized = remotePath(filePath);
		return this.run(
			token,
			id,
			async (resource, ms, abort) =>
				(await resource.scan({ path: normalized, timeoutMs: ms, signal: abort })).map((item) => {
					const result: FilePathEntry = {
						name: item.name,
						info: item.info,
						path: path.posix.join(normalized, item.name),
					};
					if (item.longName !== undefined) {
						result.longName = item.longName;
					}
					return result;
				}),
			signal,
		);
	}

	search(
		token: string | null,
		id: string,
		rootPath: string,
		query: string,
		signal?: AbortSignal,
	): Promise<FileSearchResult> {
		const root = remotePath(rootPath);
		const normalizedQuery = query.trim().slice(0, 256).toLocaleLowerCase();
		if (!normalizedQuery) {
			return Promise.resolve({ items: [], truncated: false });
		}
		return this.run(
			token,
			id,
			async (resource, ms, abort) => {
				const remaining = this.remaining(ms, abort);
				return searchFiles(resource, root, normalizedQuery, remaining, abort);
			},
			signal,
		);
	}

	getEntry(token: string | null, id: string, filePath: string, signal?: AbortSignal): Promise<FilePathEntry> {
		const normalized = remotePath(filePath);
		return this.run(
			token,
			id,
			async (resource, ms, abort) => ({
				name: path.posix.basename(normalized),
				path: normalized,
				info: await resource.stat({
					path: normalized,
					followLinks: false,
					timeoutMs: ms,
					signal: abort,
				}),
			}),
			signal,
		);
	}

	readBinary(
		token: string | null,
		id: string,
		filePath: string,
		maxBytes: number,
		emit: FileBinaryEmit,
		signal?: AbortSignal,
	): Promise<void> {
		const normalized = remotePath(filePath);
		if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > WORKSPACE_FILES_MAX_BINARY_READ_BYTES) {
			throw new RemoteFileFailure('invalid_input');
		}
		return this.run(
			token,
			id,
			async (resource, ms, abort) => {
				const remaining = this.remaining(ms, abort);
				const info = await resource.stat({
					path: normalized,
					followLinks: true,
					timeoutMs: remaining(),
					signal: abort,
				});
				if (info.kind !== 'file') {
					throw new RemoteFileFailure('invalid_input');
				}
				if (info.size > maxBytes) {
					throw new RemoteFileFailure('limit_exceeded');
				}
				const source = await resource.openRead({
					path: normalized,
					maxBytes,
					length: info.size,
					timeoutMs: remaining(),
					signal: abort,
				});
				for await (const chunk of source) {
					abort.throwIfAborted();
					remaining();
					await emit({ kind: 'data', bytes: chunk }, abort, remaining);
				}
				// The final frame is part of the same admitted operation, not an
				// unbounded follow-up after its cancellation timer has been cleared.
				await emit({ kind: 'end' }, abort, remaining);
			},
			signal,
		);
	}

	saveText(
		token: string | null,
		id: string,
		filePath: string,
		content: string,
		encoding?: string,
		signal?: AbortSignal,
	): Promise<void> {
		const normalized = remotePath(filePath);
		const bytes = encodeText(content, encoding);
		return this.run(
			token,
			id,
			async (resource, ms, abort) => {
				const remaining = this.remaining(ms, abort);
				const before = await this.optionalStat(resource, normalized, false, remaining, abort);
				const staged = await resource.stage({
					path: normalized,
					bytes,
					mode: before === null ? undefined : before.mode & 0o7777,
					timeoutMs: remaining(),
					signal: abort,
				});
				try {
					await staged.commit('replace');
				} catch (error) {
					return await this.discard(staged, error);
				}
			},
			signal,
			true,
		);
	}

	createFile(
		token: string | null,
		id: string,
		filePath: string,
		content = '',
		encoding?: string,
		signal?: AbortSignal,
	): Promise<void> {
		const normalized = remotePath(filePath);
		const bytes = encodeText(content, encoding);
		return this.run(
			token,
			id,
			(resource, ms, abort) =>
				resource.create({
					path: normalized,
					bytes,
					timeoutMs: ms,
					signal: abort,
				}),
			signal,
			true,
		);
	}

	createDirectory(token: string | null, id: string, filePath: string, signal?: AbortSignal): Promise<void> {
		const normalized = remotePath(filePath);
		return this.run(
			token,
			id,
			(resource, ms, abort) => resource.mkdir({ path: normalized, timeoutMs: ms, signal: abort }),
			signal,
			true,
		);
	}

	moveEntry(token: string | null, id: string, from: string, to: string, signal?: AbortSignal): Promise<void> {
		const source = remotePath(from);
		const destination = remotePath(to);
		return this.run(
			token,
			id,
			(resource, ms, abort) => resource.rename({ from: source, to: destination, timeoutMs: ms, signal: abort }),
			signal,
			true,
		);
	}

	changeMode(token: string | null, id: string, filePath: string, mode: number, signal?: AbortSignal): Promise<void> {
		const normalized = remotePath(filePath);
		if (!Number.isSafeInteger(mode) || mode < 0 || mode > 0o7777) {
			throw new RemoteFileFailure('invalid_input');
		}
		return this.run(
			token,
			id,
			(resource, ms, abort) => resource.chmod({ path: normalized, mode, timeoutMs: ms, signal: abort }),
			signal,
			true,
		);
	}

	resolvePath(
		token: string | null,
		id: string,
		requestedPath: string,
		signal?: AbortSignal,
	): Promise<ResolvedFilePath> {
		const input = remotePath(requestedPath);
		return this.run(
			token,
			id,
			async (resource, ms, abort) => {
				const remaining = this.remaining(ms, abort);
				const absolutePath = await resource.realpath({ path: input, timeoutMs: remaining(), signal: abort });
				const info = await resource.stat({
					path: absolutePath,
					followLinks: true,
					timeoutMs: remaining(),
					signal: abort,
				});
				return {
					requestedPath: input,
					absolutePath,
					targetType: info.kind === 'file' ? 'file' : info.kind === 'directory' ? 'directory' : 'other',
				};
			},
			signal,
		);
	}

	private async removeTree(
		resource: FileResource,
		filePath: string,
		remaining: () => number,
		signal: AbortSignal,
		ancestors: ReadonlySet<string>,
		changed: { value: boolean },
	): Promise<void> {
		const info = await this.optionalStat(resource, filePath, false, remaining, signal);
		if (info === null) {
			return;
		}
		if (info.kind !== 'directory') {
			await resource.remove({ path: filePath, timeoutMs: remaining(), signal });
			changed.value = true;
			return;
		}
		const realPath = await resource.realpath({ path: filePath, timeoutMs: remaining(), signal });
		if (ancestors.has(realPath)) {
			return;
		}
		const next = new Set(ancestors);
		next.add(realPath);
		for (const entry of await resource.scan({ path: filePath, timeoutMs: remaining(), signal })) {
			await this.removeTree(resource, path.posix.join(filePath, entry.name), remaining, signal, next, changed);
		}
		await resource.rmdir({ path: filePath, timeoutMs: remaining(), signal });
		changed.value = true;
	}

	private async forceRemoveTree(
		resource: FileResource,
		filePath: string,
		remaining: () => number,
		signal: AbortSignal,
	): Promise<void> {
		const normal = await resource.forceRemove({
			path: filePath,
			privileged: false,
			timeoutMs: remaining(),
			signal,
		});
		if (normal === 'completed') {
			return;
		}
		if (normal === 'unknown') {
			throw new RemoteFileFailure('operation_unknown');
		}
		const privileged = await resource.forceRemove({
			path: filePath,
			privileged: true,
			timeoutMs: remaining(),
			signal,
		});
		if (privileged !== 'completed') {
			throw new RemoteFileFailure('operation_unknown');
		}
	}

	removeMany(
		token: string | null,
		id: string,
		paths: readonly string[],
		forceDirectoryPaths: readonly string[] = [],
		signal?: AbortSignal,
	): Promise<void> {
		if (!Array.isArray(paths) || !Array.isArray(forceDirectoryPaths)) {
			throw new RemoteFileFailure('invalid_input');
		}
		const normalized = paths.map((item) => remotePath(item, true));
		const forced = new Set(forceDirectoryPaths.map((item) => remotePath(item, true)));
		for (const item of forced) {
			if (!normalized.includes(item)) {
				throw new RemoteFileFailure('invalid_input');
			}
		}
		if (normalized.length === 0) {
			return Promise.resolve();
		}
		return this.run(
			token,
			id,
			async (resource, ms, abort) => {
				const remaining = this.remaining(ms, abort);
				const changed = { value: false };
				for (const item of normalized) {
					try {
						if (forced.has(item)) {
							await this.forceRemoveTree(resource, item, remaining, abort);
							changed.value = true;
						} else {
							await this.removeTree(resource, item, remaining, abort, new Set(), changed);
						}
					} catch (cause) {
						throw changed.value && !isUnknown(cause)
							? new RemoteFileFailure('operation_unknown', { cause })
							: cause;
					}
				}
			},
			signal,
			true,
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
		if (!record || record.userId !== userId || record.tokenHash !== tokenHash(token)) {
			throw new RemoteFileFailure('not_found');
		}
		if (current) {
			await this.closeOwned(current);
		} else if (finished) {
			await finished.completion;
		}
	}

	private closeOwned(record: OwnedResource): Promise<void> {
		if (record.closePromise) {
			return record.closePromise;
		}
		if (record.workspaceId !== undefined) {
			for (const [key, batch] of this.preparedUploads) {
				if (batch.ownerId === record.id) {
					this.preparedUploads.delete(key);
				}
			}
			for (const task of this.uploads.values()) {
				if (task.ownerId === record.id) {
					task.fail(new RemoteFileFailure('remote_unavailable'));
					task.controller.abort();
				}
			}
			for (const task of this.copyMoves.values()) {
				if (task.ownerId === record.id || task.sourceOwnerId === record.id) {
					task.controller.abort();
				}
			}
			for (const task of this.archives.values()) {
				if (task.ownerId === record.id) {
					task.controller.abort();
				}
			}
		}
		for (const controller of record.active) {
			controller.abort();
		}
		const completion = Promise.resolve().then(async () => {
			if (record.inFlight.size) {
				await Promise.allSettled([...record.inFlight]);
			}
			const failures: unknown[] = [];
			try {
				await record.resource.close();
			} catch (cause) {
				failures.push(cause);
			}
			if (record.workspaceId !== undefined) {
				for (const task of [...this.uploads.values(), ...this.copyMoves.values(), ...this.archives.values()]) {
					const belongsToWorkspace =
						task.ownerId === record.id || ('sourceOwnerId' in task && task.sourceOwnerId === record.id);
					if (belongsToWorkspace && task.cleanupFailure !== null) {
						failures.push(task.cleanupFailure);
					}
				}
			}
			const retainedTransferFailure = this.transferCleanupByOwner.get(record.id);
			if (retainedTransferFailure) {
				failures.push(retainedTransferFailure);
			}
			if (failures.length > 0) {
				// A closed Workspace lease does not confirm release of its independent transfer resources.
				throw new RemoteResourceCleanupFailure(failures);
			}
		});
		record.closePromise = completion;
		this.closing.set(record.id, {
			userId: record.userId,
			tokenHash: record.tokenHash,
			completion,
			workspaceId: record.workspaceId,
		});
		this.owners.delete(record.id);
		void completion.then(
			() => {
				this.transferCleanupByOwner.delete(record.id);
				if (record.workspaceId !== undefined) {
					this.workspaceReservations.delete(record.workspaceId);
				}
				this.rememberClosed(record.id, completion);
			},
			(error) => {
				if (record.workspaceId === undefined) {
					this.unconfirmedIndependentClosures.add(record.id);
				}
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
		this.downloadTickets.close();
		this.preparedUploads.clear();
		for (const task of this.uploads.values()) {
			task.fail(new RemoteFileFailure('remote_unavailable'));
			task.controller.abort();
		}
		for (const task of this.copyMoves.values()) {
			task.controller.abort();
		}
		for (const task of this.archives.values()) {
			task.controller.abort();
		}
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
			for (const controller of record.active) {
				controller.abort();
			}
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
