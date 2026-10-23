import type {
	SuspendedRevocationReason,
	SuspendedTerminationReason,
	SuspendedRemovalDisposition,
} from '@nexus-terminal/shared/remote/suspend/values';
import type { WorkspaceMachineTaskScope, WorkspaceResourceUsage } from '../model/workspace-types.js';
import {
	WORKSPACE_SUSPEND_MAX_SNAPSHOT_BYTES,
	WORKSPACE_SUSPEND_MAX_HISTORY_PAGE_BYTES,
	WORKSPACE_SUSPEND_MAX_NAME_CHARACTERS,
	SUSPENDED_LOG_MAX_BYTES,
} from '@nexus-terminal/shared/remote/suspend/values';
import { randomUUID } from 'node:crypto';
import { FailureSummary } from '../../../../platform/lifecycle/failure-summary.js';
import type { SessionTokenModel } from '../model/session-token-model.js';
import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import type { RemoteFileService } from '../../files/service/file-service.js';
import type { AccessPublicApi } from '../../../access/public.js';
import type { TargetsPublicApi } from '../../../targets/public.js';
import type { RemoteSessionService } from './session-service.js';
import type { SessionCloseReason } from '../model/session-types.js';
import {
	WORKSPACE_TERMINAL_MAX_COLUMNS,
	WORKSPACE_TERMINAL_MAX_ROWS,
	WORKSPACE_TERMINAL_MAX_INPUT_BYTES,
	WORKSPACE_TERMINAL_MAX_IN_FLIGHT_BYTES,
} from '@nexus-terminal/shared/remote/workspace/values';
import type { WorkspaceFileAttachment, WorkspaceFileAuthority } from '../../files/model/file-types.js';
import { RemoteFileFailure } from '../../files/model/file-types.js';
import type { WorkspaceShellModelFactory } from '../model/workspace-shell-model.js';
import { WorkspaceShellService } from './workspace-shell-service.js';
import type { WorkspaceHistoryModel } from '../model/workspace-history-model.js';
import type { WorkspaceCommandModel } from '../model/workspace-command-model.js';
import {
	WorkspaceFailure,
	type WorkspaceLease,
	type WorkspaceOutput,
	type WorkspacePhase,
	type WorkspaceReplay,
	type WorkspaceSnapshot,
	type WorkspaceFileState,
	type SuspendedWorkspaceView,
	type WorkspaceDirectoryEvent,
	type WorkspaceCheckpoint,
	type WorkspaceViewport,
	type PreparedSuspendedWorkspace,
	type WorkspaceLogDelivery,
} from '../model/workspace-types.js';

const MAX_WORKSPACES = 64;
const JOURNAL_BYTES = 8 * 1024 * 1024;
const DETACH_GRACE_MS = 120_000;
const RESUME_ACK_MS = 15_000;
const OPEN_MS = 30_000;
const TOKEN_RE = /^[A-Za-z0-9_-]{8,128}$/u;
const MAX_SUSPENDED_PER_USER = 32;
const SUSPENDED_RETENTION_MS = 24 * 60 * 60_000;
const MAX_SUSPEND_INITIAL_BYTES = WORKSPACE_SUSPEND_MAX_SNAPSHOT_BYTES;
const MAX_SUSPEND_PENDING_BYTES = 4 * 1024 * 1024;
const CLOSE_CONFIRMATION_MS = 30_000;

interface SuspendedMark {
	readonly id: string;
	readonly originalId: string;
	readonly since: number;
	customName: string | null;
	generation: number;
	ownerId: string | null;
	prepared: boolean;
	recording: boolean;
	tail: Promise<void>;
	queuedBytes: number;
	failure: unknown | null;
	retentionTimer: ReturnType<typeof setTimeout> | null;
	leaseExpiresAt: number | null;
	checkpoint: WorkspaceCheckpoint | null;
	viewport: WorkspaceViewport;
	unmarking: Promise<void> | null;
}

interface PendingSuspendedResume {
	readonly oldId: string;
	readonly newId: string;
	readonly attachmentId: string;
	readonly tokenHash: string;
	readonly nextToken: string;
	readonly nextGeneration: number;
	readonly ownerGeneration: number;
	history: Uint8Array;
	historyCursor: number;
	readonly lateOutput: Uint8Array[];
	lateBytes: number;
	readonly revokedListeners: Set<(reason: SuspendedRevocationReason) => void>;
	timer: ReturnType<typeof setTimeout>;
}

interface SuspendedTombstone {
	readonly userId: number;
	readonly mark: SuspendedMark;
	readonly connectionId: number;
	readonly connectionName: string;
	readonly disconnectedAt: number;
	readonly timer: ReturnType<typeof setTimeout>;
}

interface InputChunk {
	bytes: Uint8Array;
}

type CleanupOutcome = { kind: 'ok' } | { kind: 'failed'; error: unknown } | { kind: 'timeout' };

interface PendingResume {
	attachmentId: string;
	tokenHash: string;
	nextToken: string;
	nextGeneration: number;
	timer: ReturnType<typeof setTimeout>;
}

interface WorkspaceRecord {
	id: string;
	connectionId: number;
	userId: number;
	tokenHash: string;
	phase: WorkspacePhase;
	controller: AbortController;
	shellId: string | null;
	shellIntegration: WorkspaceShellService | null;
	file: WorkspaceFileAttachment | null;
	fileTokenHash: string | null;
	fileState: WorkspaceFileState;
	fileTask: Promise<void> | null;
	fileFailure: RemoteResourceCleanupFailure | null;
	fileListeners: Set<(status: WorkspaceFileState) => void>;
	connectionName: string;
	resumeToken: string;
	generation: number;
	attachmentId: string | null;
	pendingResume: PendingResume | null;
	detachTimer: ReturnType<typeof setTimeout> | null;
	output: Uint8Array[];
	outputBytes: number;
	offset: number;
	outputListeners: Set<(item: WorkspaceOutput) => void>;
	closedListeners: Set<(reason: SessionCloseReason) => void>;
	revokedListeners: Set<(suspendedId: string, generation: number, reason: SuspendedRevocationReason) => void>;
	unmarkedListeners: Set<(suspendedId: string, generation: number) => void>;
	directoryListeners: Set<(event: WorkspaceDirectoryEvent) => void>;
	input: InputChunk[];
	inputBytes: number;
	waitingDrain: boolean;
	pauseByConsumer: boolean;
	subscribers: Array<() => void>;
	closePromise: Promise<void> | null;
	openPromise: Promise<WorkspaceLease> | null;
	lastConnectedAt: number;
	suspend: SuspendedMark | null;
	pendingSuspended: PendingSuspendedResume | null;
	historyCursor: {
		current: number;
		latest: number;
		suspendedId: string;
		tail: Promise<void>;
	} | null;
	viewport: WorkspaceViewport;
}

function releaseCallbacks(callbacks: Array<() => void>): unknown[] {
	const failures: unknown[] = [];
	for (const callback of callbacks.splice(0)) {
		try {
			callback();
		} catch (error) {
			failures.push(error);
		}
	}
	return failures;
}

/** The sole ordinary Workspace owner. RemoteSessionService owns only its technical PTY lease. */
export class WorkspaceService {
	private readonly machineTasks = new Map<WorkspaceRecord, Map<AbortController, Promise<unknown>>>();
	private readonly records = new Map<string, WorkspaceRecord>();
	private readonly tasks = new Set<Promise<unknown>>();
	private readonly failures = new FailureSummary();
	private readonly recordedFailures = new WeakSet<Error>();
	private readonly exports = new Map<AbortController, { id: string; task: Promise<boolean> }>();
	private readonly suspended = new Map<string, WorkspaceRecord>();
	private readonly disconnected = new Map<string, SuspendedTombstone>();
	private readonly catalogListeners = new Set<(userId: number) => void>();
	private readonly autoTerminationListeners = new Set<
		(userId: number, suspendedId: string, reason: SuspendedTerminationReason) => void
	>();
	private readonly leaseSweeper: ReturnType<typeof setInterval>;
	private accepting = true;
	private closePromise: Promise<void> | null = null;

	constructor(
		private readonly access: AccessPublicApi,
		private readonly shells: RemoteSessionService,
		private readonly files: RemoteFileService,
		private readonly commands: WorkspaceCommandModel,
		private readonly targets: Pick<TargetsPublicApi, 'get'>,
		private readonly shellModels: WorkspaceShellModelFactory,
		private readonly tokens: SessionTokenModel,
		private readonly logs?: WorkspaceHistoryModel,
	) {
		this.leaseSweeper = setInterval(() => this.sweepSuspendedLeases(), 2_000);
		this.leaseSweeper.unref();
	}

	getResourceUsage(): WorkspaceResourceUsage {
		const records = new Set([...this.records.values(), ...this.suspended.values()]);
		const marks = new Set([...records].flatMap((record) => (record.suspend ? [record.suspend] : [])));
		for (const record of this.disconnected.values()) {
			marks.add(record.mark);
		}
		let outputBytes = 0;
		let inputBytes = 0;
		let resumeBytes = 0;
		let workspaces = 0;
		for (const record of records) {
			if (record.phase !== 'suspended') {
				workspaces++;
			}
			outputBytes += record.outputBytes;
			inputBytes += record.inputBytes;
			if (record.pendingSuspended) {
				resumeBytes += record.pendingSuspended.history.byteLength + record.pendingSuspended.lateBytes;
			}
		}
		return {
			workspaces,
			suspended: marks.size,
			disconnected: this.disconnected.size,
			outputBytes,
			inputBytes,
			resumeBytes,
			suspendQueueBytes: [...marks].reduce((bytes, mark) => bytes + mark.queuedBytes, 0),
		};
	}

	private recordFailure(error: unknown): void {
		if (error instanceof Error) {
			if (this.recordedFailures.has(error)) {
				return;
			}
			this.recordedFailures.add(error);
		}
		this.failures.record(error);
	}

	private sweepSuspendedLeases(): void {
		const now = Date.now();
		for (const record of this.suspended.values()) {
			const mark = record.suspend;
			if (
				!mark ||
				!mark.ownerId ||
				!mark.leaseExpiresAt ||
				mark.leaseExpiresAt > now ||
				record.phase !== 'attached' ||
				record.attachmentId !== mark.ownerId
			) {
				continue;
			}
			for (const listener of record.revokedListeners) {
				try {
					listener(mark.id, mark.generation, 'lease_expired');
				} catch {
					/* listener isolation */
				}
			}
			this.detach(record.id, mark.ownerId);
		}
	}

	onSuspendedCatalogChanged(listener: (userId: number) => void): () => void {
		this.catalogListeners.add(listener);
		return () => {
			this.catalogListeners.delete(listener);
		};
	}

	private publishSuspendedCatalogChanged(userId: number): void {
		for (const listener of this.catalogListeners) {
			try {
				listener(userId);
			} catch (cause) {
				this.recordFailure(cause);
			}
		}
	}

	onAutoTerminated(
		listener: (userId: number, suspendedId: string, reason: SuspendedTerminationReason) => void,
	): () => void {
		this.autoTerminationListeners.add(listener);
		return () => this.autoTerminationListeners.delete(listener);
	}

	private publishAutoTerminated(userId: number, suspendedId: string, reason: SuspendedTerminationReason): void {
		for (const listener of this.autoTerminationListeners) {
			try {
				listener(userId, suspendedId, reason);
			} catch {
				/* isolate WS listener */
			}
		}
	}

	private track<T>(task: Promise<T>): Promise<T> {
		this.tasks.add(task);
		void task.finally(() => this.tasks.delete(task)).catch(() => undefined);
		return task;
	}

	/** A deadline only bounds the caller's wait. The actual technical release
	 * continues under its original owner; timeout always means unknown, never
	 * permission to release this Workspace admission slot.
	 */
	private async cleanupOutcome(task: Promise<unknown>, deadline: number): Promise<CleanupOutcome> {
		let timer: ReturnType<typeof setTimeout> | null = null;
		let timedOut = false;
		const observed = this.track(
			task.then(
				() => undefined,
				(error) => {
					if (timedOut) {
						this.recordFailure(new RemoteResourceCleanupFailure([error]));
					}
					throw error;
				},
			),
		);
		const time = Math.max(1, deadline - Date.now());
		const expired = new Promise<{ kind: 'timeout' }>((resolve) => {
			timer = setTimeout(() => {
				timedOut = true;
				resolve({ kind: 'timeout' });
			}, time);
			timer.unref();
		});
		try {
			return await Promise.race([
				observed.then(
					(): { kind: 'ok' } => ({ kind: 'ok' }),
					(error): { kind: 'failed'; error: unknown } => ({ kind: 'failed', error }),
				),
				expired,
			]);
		} finally {
			if (timer) {
				clearTimeout(timer);
			}
		}
	}

	private async identity(token: string | null): Promise<number> {
		if (!token) {
			throw new WorkspaceFailure('unauthenticated');
		}
		const identity = await this.access.authenticate(token);
		if (!identity) {
			throw new WorkspaceFailure('unauthenticated');
		}
		if (identity.userId !== 1) {
			throw new WorkspaceFailure('forbidden');
		}
		return identity.userId;
	}

	/** Notification delivery must re-authenticate the cookie. The WS upgrade
	 * happened in the past and is not a perpetual authorization grant. */
	async mayReceiveSuspendedEvent(token: string | null, ownerId: number): Promise<boolean> {
		if (!this.accepting || !token) {
			return false;
		}
		try {
			return (await this.identity(token)) === ownerId && this.accepting;
		} catch {
			return false;
		}
	}

	private async untilAbort<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
		if (signal.aborted) {
			void task.catch(() => undefined);
			throw new WorkspaceFailure('remote_unavailable');
		}

		let onAbort: () => void = () => undefined;

		const aborted = new Promise<never>((_, reject) => {
			onAbort = () => reject(new WorkspaceFailure('remote_unavailable'));
			signal.addEventListener('abort', onAbort, { once: true });
		});
		try {
			return await Promise.race([task, aborted]);
		} finally {
			signal.removeEventListener('abort', onAbort);
			void task.catch(() => undefined);
		}
	}

	private record(id: string): WorkspaceRecord {
		const record = this.records.get(id);
		if (!record || record.phase === 'opening' || record.phase === 'closing' || record.phase === 'cleanup_unknown') {
			throw new WorkspaceFailure('not_found');
		}
		return record;
	}

	private snapshot(record: WorkspaceRecord): WorkspaceSnapshot {
		return {
			workspaceId: record.id,
			connectionId: record.connectionId,
			connectionName: record.connectionName,
			resumeToken: record.resumeToken,
			attachmentGeneration: record.generation,
			terminalOffset: record.offset,
			lastConnectedAt: record.lastConnectedAt,
		};
	}

	private lease(record: WorkspaceRecord): WorkspaceLease {
		if (!record.attachmentId) {
			throw new WorkspaceFailure('remote_unavailable');
		}
		return { ...this.snapshot(record), file: record.file, attachmentId: record.attachmentId };
	}

	open(
		token: string | null,
		id: string,
		connectionId: number,
		signal?: AbortSignal,
		viewport?: {
			columns: number;
			rows: number;
		},
	): Promise<WorkspaceLease> {
		if (!this.accepting) {
			throw new WorkspaceFailure('remote_unavailable');
		}
		if (!TOKEN_RE.test(id) || !Number.isSafeInteger(connectionId) || connectionId < 1) {
			throw new WorkspaceFailure('invalid_input');
		}
		if (this.records.has(id)) {
			throw new WorkspaceFailure('conflict');
		}
		if (new Set(this.records.values()).size >= MAX_WORKSPACES) {
			throw new WorkspaceFailure('limit_exceeded');
		}
		const columns = viewport?.columns ?? 80;
		const rows = viewport?.rows ?? 24;
		if (
			!Number.isSafeInteger(columns) ||
			columns < 2 ||
			columns > WORKSPACE_TERMINAL_MAX_COLUMNS ||
			!Number.isSafeInteger(rows) ||
			rows < 1 ||
			rows > WORKSPACE_TERMINAL_MAX_ROWS
		) {
			throw new WorkspaceFailure('invalid_input');
		}
		const record: WorkspaceRecord = {
			id,
			connectionId,
			userId: -1,
			tokenHash: '',
			phase: 'opening',
			controller: new AbortController(),
			shellId: null,
			shellIntegration: null,
			file: null,
			fileTokenHash: null,
			fileState: { kind: 'opening' },
			fileTask: null,
			fileFailure: null,
			fileListeners: new Set(),
			connectionName: '',
			resumeToken: this.tokens.issue(),
			generation: 1,
			attachmentId: randomUUID(),
			pendingResume: null,
			detachTimer: null,
			output: [],
			outputBytes: 0,
			offset: 0,
			outputListeners: new Set(),
			closedListeners: new Set(),
			revokedListeners: new Set(),
			unmarkedListeners: new Set(),
			directoryListeners: new Set(),
			input: [],
			inputBytes: 0,
			waitingDrain: false,
			pauseByConsumer: false,
			subscribers: [],
			closePromise: null,
			lastConnectedAt: Math.floor(Date.now() / 1000),
			openPromise: null,
			suspend: null,
			pendingSuspended: null,
			historyCursor: null,
			viewport: { columns, rows },
		};
		this.records.set(id, record); // Reserve before any authorization or SSH await.

		const abort = () => record.controller.abort(signal?.reason);

		signal?.addEventListener('abort', abort, { once: true });
		if (signal?.aborted) {
			abort();
		}
		const task = this.openAdmitted(record, token, columns, rows).finally(() =>
			signal?.removeEventListener('abort', abort),
		);
		record.openPromise = task;
		return this.track(task);
	}

	private async openAdmitted(
		record: WorkspaceRecord,
		token: string | null,
		columns: number,
		rows: number,
	): Promise<WorkspaceLease> {
		let primary: unknown = null;
		try {
			const userId = await this.untilAbort(this.identity(token), record.controller.signal);
			record.controller.signal.throwIfAborted();
			record.userId = userId;
			if (!token || !this.accepting) {
				throw new WorkspaceFailure('remote_unavailable');
			}
			record.tokenHash = this.tokens.digest(token);
			const shell = await this.shells.open({
				targetId: record.connectionId,
				columns,
				rows,
				timeoutMs: OPEN_MS,
				signal: record.controller.signal,
			});
			record.shellId = shell.id;
			record.controller.signal.throwIfAborted();
			const shellId = shell.id;
			record.shellIntegration = new WorkspaceShellService(
				this.shellModels.create(
					(bytes) => {
						this.shells.write(shellId, bytes);
					},
					(command, signal) => this.commands.execute(record.connectionId, shell.fingerprint, command, signal),
				),
				(event) => {
					for (const listener of record.directoryListeners) {
						try {
							listener(event);
						} catch {
							/* isolate one attachment listener */
						}
					}
				},
			);
			// Register each disposer immediately. If the next subscription
			// throws, the already-installed PTY handlers are still released.
			record.subscribers.push(this.shells.onData(shellId, (bytes) => this.appendOutput(record, bytes, false)));
			record.subscribers.push(this.shells.onStderr(shellId, (bytes) => this.appendOutput(record, bytes, true)));
			record.subscribers.push(
				this.shells.onClosed(shellId, (reason) => {
					void this.closeRecord(record, reason).catch(() => undefined);
				}),
			);
			// Prepare prompt tracking before the first attachment can send user input.
			// A shell without Bash/Zsh integration remains usable when preparation fails.
			const shellIntegrationReady = record.shellIntegration.initialize().catch(() => undefined);
			const target = await this.untilAbort(this.targets.get(record.connectionId), record.controller.signal);
			if (!target) {
				throw new WorkspaceFailure('not_found');
			}
			await this.untilAbort(shellIntegrationReady, record.controller.signal);
			record.connectionName = target.name;
			if (
				(await this.untilAbort(this.identity(token), record.controller.signal)) !== userId ||
				!this.accepting ||
				this.records.get(record.id) !== record
			) {
				throw new WorkspaceFailure('unauthenticated');
			}
			record.controller.signal.throwIfAborted();
			record.phase = 'attached';
			record.fileTask = this.track(this.openFiles(record, token, shell.fingerprint));
			return this.lease(record);
		} catch (error) {
			primary = error;
		}
		record.shellIntegration?.close();
		// Shutdown may already own this very instance. Do not start a second
		// competing SSH/File close against its tracked cleanup transaction.
		if (record.closePromise) {
			throw primary;
		}
		const failures: unknown[] = releaseCallbacks(record.subscribers);
		const deadline = Date.now() + CLOSE_CONFIRMATION_MS;
		const file = record.file;
		const shellId = record.shellId;
		const outcomes = await Promise.all([
			...(file
				? [
						this.cleanupOutcome(
							Promise.resolve().then(() => file.release()),
							deadline,
						),
					]
				: []),
			...(shellId
				? [
						this.cleanupOutcome(
							Promise.resolve().then(() => this.shells.closeSession(shellId)),
							deadline,
						),
					]
				: []),
		]);
		for (const outcome of outcomes) {
			if (outcome.kind === 'failed') {
				failures.push(outcome.error);
			}
			if (outcome.kind === 'timeout') {
				failures.push(new WorkspaceFailure('operation_unknown'));
			}
		}
		if (
			failures.length ||
			primary instanceof RemoteResourceCleanupFailure ||
			(primary instanceof RemoteFileFailure && primary.code === 'operation_unknown')
		) {
			const cleanup = new RemoteResourceCleanupFailure([primary, ...failures]);
			record.phase = 'cleanup_unknown';
			this.recordFailure(cleanup);
			throw cleanup;
		}
		if (this.records.get(record.id) === record) {
			this.records.delete(record.id);
		}
		throw primary;
	}

	private publishFileState(record: WorkspaceRecord, state: WorkspaceFileState): void {
		record.fileState = state;
		for (const listener of record.fileListeners) {
			try {
				listener(state);
			} catch {
				/* a WS cannot change resource ownership */
			}
		}
	}

	private fileAuthority(record: WorkspaceRecord, sessionDigest: string): WorkspaceFileAuthority {
		const workspaceId = record.id;
		return {
			isCurrent: () => {
				const normalPhase =
					record.phase === 'attached' || record.phase === 'detached' || record.phase === 'resuming';
				return (
					this.accepting &&
					record.id === workspaceId &&
					this.records.get(workspaceId) === record &&
					!record.controller.signal.aborted &&
					record.tokenHash === sessionDigest &&
					(record.suspend === null
						? normalPhase
						: record.phase === 'attached' && this.hasCurrentSuspendedLease(record))
				);
			},
		};
	}

	private async openFiles(record: WorkspaceRecord, token: string, fingerprint: string): Promise<void> {
		let file: WorkspaceFileAttachment | null = null;
		try {
			file = await this.files.openWorkspace(
				token,
				record.id,
				record.connectionId,
				this.fileAuthority(record, this.tokens.digest(token)),
				record.controller.signal,
			);
			if (
				file.fingerprint !== fingerprint ||
				file.targetId !== record.connectionId ||
				!this.tokens.matches(token, record.tokenHash) ||
				record.phase === 'closing' ||
				record.phase === 'cleanup_unknown' ||
				record.controller.signal.aborted ||
				!this.accepting
			) {
				throw new RemoteFileFailure('stale_target');
			}
			record.file = file;
			record.fileTokenHash = this.tokens.digest(token);
			this.publishFileState(record, { kind: 'ready', file });
		} catch (error) {
			if (file) {
				try {
					await file.release();
				} catch (cleanup) {
					error = new RemoteResourceCleanupFailure([error, cleanup]);
				}
			}
			if (
				error instanceof RemoteResourceCleanupFailure ||
				(error instanceof RemoteFileFailure && error.code === 'operation_unknown')
			) {
				record.fileFailure =
					error instanceof RemoteResourceCleanupFailure ? error : new RemoteResourceCleanupFailure([error]);
				this.recordFailure(record.fileFailure);
			}
			if (record.phase !== 'closing' && record.phase !== 'cleanup_unknown') {
				this.publishFileState(record, {
					kind: 'failed',
					reason: record.fileFailure ? 'operation_unknown' : 'remote_unavailable',
				});
			}
		}
	}

	/** Reauthentication never mutates the old FileResource session binding.
	 * Retire its lease before opening a new FileAttachment under the new login.
	 */
	private async replaceFile(
		record: WorkspaceRecord,
		old: WorkspaceFileAttachment,
		token: string,
		fingerprint: string,
		attachmentId: string,
	): Promise<void> {
		try {
			await old.release();
		} catch (error) {
			const failure =
				error instanceof RemoteResourceCleanupFailure ? error : new RemoteResourceCleanupFailure([error]);
			record.fileFailure = failure;
			this.recordFailure(failure);
			if (record.phase !== 'closing' && record.phase !== 'cleanup_unknown') {
				this.publishFileState(record, { kind: 'failed', reason: 'operation_unknown' });
			}
			return;
		}
		if (record.phase !== 'attached' || record.attachmentId !== attachmentId || record.controller.signal.aborted) {
			return;
		}
		await this.openFiles(record, token, fingerprint);
	}

	private reconcileFilesAfterResume(record: WorkspaceRecord, token: string, attachmentId: string): void {
		const shell = record.shellId ? this.shells.get(record.shellId) : null;
		if (!shell) {
			return;
		}
		// Serialize behind the previous SFTP open. An old login's late success
		// cannot overwrite the new FileResource binding or reserve the same ID.
		const previous = record.fileTask ?? Promise.resolve();
		record.fileTask = this.track(
			previous.then(async () => {
				if (
					record.phase !== 'attached' ||
					record.attachmentId !== attachmentId ||
					record.controller.signal.aborted
				) {
					return;
				}
				if (record.fileFailure) {
					this.publishFileState(record, { kind: 'failed', reason: 'operation_unknown' });
					return;
				}
				const old = record.file;
				if (old) {
					if (record.fileTokenHash === this.tokens.digest(token)) {
						try {
							await this.files.pingWorkspace(token, old.id, record.id, record.controller.signal);
							return; // Healthy existing FileResource, no transfer interruption.
						} catch {
							if (record.phase !== 'attached' || record.attachmentId !== attachmentId) {
								return;
							}
						}
					}
					record.file = null;
					record.fileTokenHash = null;
					this.publishFileState(record, { kind: 'opening' });
					await this.replaceFile(record, old, token, shell.fingerprint, attachmentId);
					return;
				}
				this.publishFileState(record, { kind: 'opening' });
				await this.openFiles(record, token, shell.fingerprint);
			}),
		);
	}

	private appendOutput(record: WorkspaceRecord, value: Uint8Array, stderr: boolean): void {
		if (record.phase === 'closing' || record.phase === 'cleanup_unknown') {
			return;
		}
		const bytes = stderr
			? Uint8Array.from(value)
			: (record.shellIntegration?.filterOutput(value) ?? Uint8Array.from(value));
		if (!bytes.length) {
			return;
		}
		if (!Number.isSafeInteger(record.offset + bytes.length)) {
			// Terminal offsets are exact integers; never wrap on long-lived shells.
			void this.closeRecord(record, 'disconnected').catch(() => undefined);
			return;
		}
		record.output.push(bytes);
		record.outputBytes += bytes.length;
		record.offset += bytes.length;
		if (record.phase === 'suspend_resuming' && record.pendingSuspended) {
			const pending = record.pendingSuspended;
			pending.lateBytes += bytes.length;
			if (pending.lateBytes > MAX_SUSPEND_PENDING_BYTES) {
				if (record.suspend) {
					record.suspend.failure = new WorkspaceFailure('limit_exceeded');
				}
				void this.closeRecord(record, 'disconnected').catch(() => undefined);
				return;
			}
			pending.lateOutput.push(bytes);
		} else if (record.suspend?.recording) {
			this.appendSuspendedOutput(record, record.suspend, bytes);
		}
		while (record.outputBytes > JOURNAL_BYTES) {
			const first = record.output[0];
			if (!first) {
				throw new WorkspaceFailure('remote_unavailable');
			}
			const excess = record.outputBytes - JOURNAL_BYTES;
			if (first.length <= excess) {
				record.output.shift();
				record.outputBytes -= first.length;
			} else {
				record.output[0] = first.subarray(excess);
				record.outputBytes -= excess;
			}
		}
		for (const listener of record.outputListeners) {
			try {
				listener({ bytes, stderr, offset: record.offset });
			} catch {
				/* isolate consumer */
			}
		}
	}

	private appendSuspendedOutput(
		record: WorkspaceRecord,
		mark: SuspendedMark,
		bytes: Uint8Array,
		checkpointAlreadySeeded = false,
	): void {
		const history = this.logs;
		if (!history || mark.failure !== null || !mark.recording) {
			return;
		}
		if (bytes.length > MAX_SUSPEND_PENDING_BYTES - mark.queuedBytes) {
			this.failSuspendedRecording(record, mark, new WorkspaceFailure('limit_exceeded'));
			return;
		}
		const copy = Uint8Array.from(bytes);
		mark.queuedBytes += copy.length;
		const task = mark.tail
			.then(async () => {
				await history.append(mark.id, copy);
				if (mark.checkpoint && !checkpointAlreadySeeded) {
					try {
						await mark.checkpoint.write(copy);
					} catch {
						// A corrupt/incompatible VT checkpoint may never discard the
						// raw log. The resume path falls back to a bounded raw tail.
						await mark.checkpoint.dispose();
						mark.checkpoint = null;
					}
				}
			})
			.then(
				() => {
					mark.queuedBytes -= copy.length;
					if (
						record.shellId &&
						mark.queuedBytes < MAX_SUSPEND_PENDING_BYTES / 2 &&
						(record.phase === 'suspended' || record.phase === 'attached') &&
						!record.pauseByConsumer &&
						!mark.prepared &&
						this.shells.get(record.shellId)
					) {
						try {
							this.shells.resumeOutput(record.shellId);
						} catch (error) {
							this.failSuspendedRecording(record, mark, error);
						}
					}
				},
				(error) => {
					mark.queuedBytes -= copy.length;
					if (mark.failure === null) {
						this.failSuspendedRecording(record, mark, error);
					}
				},
			);
		mark.tail = task;
		if (mark.queuedBytes > MAX_SUSPEND_PENDING_BYTES / 2 && record.shellId) {
			try {
				this.shells.pauseOutput(record.shellId);
			} catch (error) {
				this.failSuspendedRecording(record, mark, error);
			}
		}
	}

	private failSuspendedRecording(record: WorkspaceRecord, mark: SuspendedMark, error: unknown): void {
		if (mark.failure !== null) {
			return;
		}
		mark.failure = error;
		mark.recording = false;
		if (record.shellId) {
			try {
				this.shells.pauseOutput(record.shellId);
			} catch (cleanup) {
				this.recordFailure(cleanup);
			}
		}
		void this.closeRecord(record, 'disconnected').catch(() => undefined);
	}

	async markSuspend(
		token: string | null,
		id: string,
		attachmentId: string,
		initialBuffer?: string,
	): Promise<{ suspendedSessionId: string }> {
		if (!this.logs) {
			throw new WorkspaceFailure('remote_unavailable');
		}
		if (
			initialBuffer !== undefined &&
			(typeof initialBuffer !== 'string' || Buffer.byteLength(initialBuffer, 'utf8') > MAX_SUSPEND_INITIAL_BYTES)
		) {
			throw new WorkspaceFailure('invalid_input');
		}
		if (!(await this.allowed(token, id, attachmentId))) {
			throw new WorkspaceFailure('not_found');
		}
		const record = this.record(id);
		if (record.phase !== 'attached' || record.attachmentId !== attachmentId) {
			throw new WorkspaceFailure('not_found');
		}
		if (record.suspend) {
			const existing = record.suspend;
			if (!existing.recording || existing.unmarking || existing.failure !== null) {
				throw new WorkspaceFailure('operation_unknown');
			}
			if (initialBuffer && existing.checkpoint) {
				existing.tail = existing.tail.then(async () => {
					try {
						await existing.checkpoint?.reset(initialBuffer, record.viewport);
					} catch {
						await existing.checkpoint?.dispose();
						existing.checkpoint = null;
					}
				});
			}
			await existing.tail;
			if (
				!(await this.allowed(token, id, attachmentId)) ||
				record.suspend !== existing ||
				!existing.recording ||
				existing.failure !== null
			) {
				throw new WorkspaceFailure('not_found');
			}
			return { suspendedSessionId: existing.id };
		}
		if (
			this.suspended.size + this.disconnected.size >= MAX_WORKSPACES ||
			[...this.suspended.values()].filter((entry) => entry.userId === record.userId).length +
				[...this.disconnected.values()].filter((entry) => entry.userId === record.userId).length >=
				MAX_SUSPENDED_PER_USER
		) {
			throw new WorkspaceFailure('limit_exceeded');
		}
		const mark: SuspendedMark = {
			id: randomUUID(),
			originalId: id,
			since: Date.now(),
			customName: null,
			generation: 1,
			ownerId: attachmentId,
			prepared: false,
			recording: true,
			tail: Promise.resolve(),
			queuedBytes: 0,
			failure: null,
			retentionTimer: null,
			leaseExpiresAt: Date.now() + 45_000,
			checkpoint: this.logs.createCheckpoint(initialBuffer, record.viewport),
			viewport: { ...record.viewport },
			unmarking: null,
		};
		record.suspend = mark;
		this.suspended.set(mark.id, record);
		this.publishSuspendedCatalogChanged(record.userId);
		if (initialBuffer) {
			this.appendSuspendedOutput(record, mark, Buffer.from(initialBuffer, 'utf8'), true);
		}
		await mark.tail;
		if (mark.failure !== null) {
			throw new WorkspaceFailure('remote_unavailable');
		}
		if (!(await this.allowed(token, id, attachmentId)) || record.suspend !== mark || !mark.recording) {
			throw new WorkspaceFailure('not_found');
		}
		return { suspendedSessionId: mark.id };
	}

	async prepareSuspend(
		token: string | null,
		id: string,
		attachmentId: string,
		initialBuffer?: string,
	): Promise<void> {
		await this.markSuspend(token, id, attachmentId, initialBuffer);
		const record = this.record(id);
		if (
			record.phase !== 'attached' ||
			record.attachmentId !== attachmentId ||
			!record.suspend ||
			record.suspend.unmarking
		) {
			throw new WorkspaceFailure('not_found');
		}
		const mark = record.suspend;
		if (record.shellId) {
			this.shells.pauseOutput(record.shellId);
		}
		mark.prepared = true;
		await mark.tail;
		if (
			!(await this.allowed(token, id, attachmentId)) ||
			record.suspend !== mark ||
			!mark.prepared ||
			!mark.recording
		) {
			throw new WorkspaceFailure('not_found');
		}
		if (mark.failure !== null) {
			throw new WorkspaceFailure('remote_unavailable');
		}
	}

	releasePreparedSuspend(id: string, attachmentId: string): void {
		const record = this.records.get(id);
		if (
			!record ||
			record.phase !== 'attached' ||
			record.attachmentId !== attachmentId ||
			!record.suspend?.prepared
		) {
			return;
		}
		record.suspend.prepared = false;
		this.resumeIfUnblocked(record);
	}

	async commitSuspend(
		token: string | null,
		id: string,
		attachmentId: string,
		initialBuffer?: string,
	): Promise<{ suspendedSessionId: string }> {
		const result = await this.markSuspend(token, id, attachmentId, initialBuffer);
		const record = this.record(id);
		if (
			!(await this.allowed(token, id, attachmentId)) ||
			record.phase !== 'attached' ||
			record.attachmentId !== attachmentId ||
			record.suspend?.id !== result.suspendedSessionId ||
			!record.suspend.recording
		) {
			throw new WorkspaceFailure('not_found');
		}
		if (record.suspend?.prepared) {
			record.suspend.prepared = false;
			this.resumeIfUnblocked(record);
		}
		return result;
	}

	async unmarkSuspend(token: string | null, id: string, attachmentId: string): Promise<void> {
		if (!(await this.allowed(token, id, attachmentId))) {
			throw new WorkspaceFailure('not_found');
		}
		const record = this.record(id);
		const mark = record.suspend;
		if (!mark) {
			return;
		}
		const history = this.logs;
		if (!history) {
			throw new WorkspaceFailure('remote_unavailable');
		}
		if (record.phase !== 'attached' || record.attachmentId !== attachmentId) {
			throw new WorkspaceFailure('not_found');
		}
		await this.clearSuspendedMark(record, mark);
	}

	private clearSuspendedMark(record: WorkspaceRecord, mark: SuspendedMark): Promise<void> {
		if (mark.unmarking) {
			return mark.unmarking;
		}
		const task = Promise.resolve().then(() => this.clearSuspendedMarkOwned(record, mark));
		mark.unmarking = task;
		return this.track(task);
	}

	private async clearSuspendedMarkOwned(record: WorkspaceRecord, mark: SuspendedMark): Promise<void> {
		const history = this.logs;
		if (!history || record.suspend !== mark || !mark.recording || mark.failure !== null) {
			throw new WorkspaceFailure('operation_unknown');
		}
		mark.recording = false;
		if (mark.prepared) {
			mark.prepared = false;
			this.resumeIfUnblocked(record);
		}
		await mark.tail;
		try {
			await this.settleExports(mark.id);
			await history.delete(mark.id);
			await mark.checkpoint?.dispose();
		} catch (error) {
			const failure = new RemoteResourceCleanupFailure([error]);
			this.recordFailure(failure);
			mark.failure = failure;
			throw new WorkspaceFailure('operation_unknown', { cause: failure });
		}
		if (record.suspend === mark && record.phase !== 'closing' && record.phase !== 'cleanup_unknown') {
			record.suspend = null;
			this.suspended.delete(mark.id);
			record.historyCursor = null;
			for (const listener of record.unmarkedListeners) {
				try {
					listener(mark.id, mark.generation);
				} catch (cause) {
					this.recordFailure(cause);
				}
			}
			this.publishSuspendedCatalogChanged(record.userId);
			return;
		}
		throw new WorkspaceFailure('operation_unknown');
	}

	/** Prepared suspended resume does not transfer the PTY yet. The old
	 * suspended owner keeps the only live shell while baseline history is sent.
	 * A timer, transport close or failed history send rolls the reservation back.
	 */
	async prepareSuspendedResume(
		token: string | null,
		suspendedId: string,
		workspaceId: string,
		takeover = false,
	): Promise<PreparedSuspendedWorkspace> {
		const userId = await this.identity(token);
		if (!this.accepting || !token || !this.logs || !TOKEN_RE.test(workspaceId)) {
			throw new WorkspaceFailure('invalid_input');
		}
		const record = this.suspended.get(suspendedId);
		const mark = record?.suspend;
		if (
			!record ||
			!mark ||
			record.userId !== userId ||
			!mark.recording ||
			mark.unmarking ||
			mark.failure !== null ||
			!record.shellId ||
			!this.shells.get(record.shellId)
		) {
			throw new WorkspaceFailure('not_found');
		}
		if (
			workspaceId === record.id ||
			(this.records.has(workspaceId) &&
				!(
					record.phase === 'suspend_resuming' &&
					takeover &&
					record.pendingSuspended?.newId === workspaceId &&
					this.records.get(workspaceId) === record
				))
		) {
			throw new WorkspaceFailure('conflict');
		}
		if (record.phase === 'suspend_resuming' && takeover && record.pendingSuspended) {
			this.rollbackSuspendedResume(record, record.pendingSuspended, 'takeover');
		}
		const ownerExpired = mark.leaseExpiresAt === null || mark.leaseExpiresAt <= Date.now();
		if (
			record.phase === 'attached' &&
			(takeover || ownerExpired) &&
			record.attachmentId &&
			mark.ownerId === record.attachmentId
		) {
			const previousOwner = record.attachmentId;
			for (const listener of record.revokedListeners) {
				try {
					listener(mark.id, mark.generation, ownerExpired ? 'lease_expired' : 'takeover');
				} catch {
					/* ownership change still proceeds */
				}
			}
			this.detach(record.id, previousOwner);
		}
		if (record.phase !== 'suspended') {
			throw new WorkspaceFailure('conflict');
		}
		const attachmentId = randomUUID();
		const pending: PendingSuspendedResume = {
			oldId: record.id,
			newId: workspaceId,
			attachmentId,
			tokenHash: this.tokens.digest(token),
			nextToken: this.tokens.issue(),
			nextGeneration: record.generation + 1,
			ownerGeneration: mark.generation + 1,
			history: new Uint8Array(),
			historyCursor: 0,
			lateOutput: [],
			lateBytes: 0,
			revokedListeners: new Set(),
			timer: setTimeout(() => this.rollbackSuspendedResume(record, pending, 'lease_expired'), 30_000),
		};
		pending.timer.unref();
		record.pendingSuspended = pending;
		record.attachmentId = attachmentId;
		record.phase = 'suspend_resuming';
		this.records.set(workspaceId, record); // Reserved before the first async log operation.
		mark.ownerId = attachmentId;
		try {
			this.publishSuspendedCatalogChanged(record.userId);
			// Pausing a disposed PTY is a real failure. The pending alias and
			// owner reservation must roll back even when pause throws.
			this.shells.pauseOutput(record.shellId);
			await mark.tail;
			if (mark.failure !== null) {
				throw new WorkspaceFailure('remote_unavailable');
			}
			let baseline: Uint8Array | null = null;
			let cursor = 0;
			if (mark.checkpoint) {
				try {
					const snapshot = await mark.checkpoint.snapshot();
					baseline = Buffer.from(snapshot.data, 'utf8');
					cursor = await this.logs.position(mark.id);
				} catch {
					await mark.checkpoint.dispose();
					mark.checkpoint = null;
				}
			}
			if (baseline === null) {
				const tail = await this.logs.readTail(mark.id, WORKSPACE_SUSPEND_MAX_HISTORY_PAGE_BYTES);
				baseline = Uint8Array.from(tail.data);
				cursor = tail.startOffset;
			}
			if (
				record.pendingSuspended !== pending ||
				record.phase !== 'suspend_resuming' ||
				(await this.identity(token)) !== userId ||
				record.pendingSuspended !== pending ||
				record.phase !== 'suspend_resuming'
			) {
				throw new WorkspaceFailure('conflict');
			}
			pending.history = baseline;
			pending.historyCursor = cursor;
			return {
				lease: {
					...this.snapshot(record),
					workspaceId,
					resumeToken: pending.nextToken,
					attachmentGeneration: pending.nextGeneration,
					terminalOffset: pending.history.length,
					file: null,
					attachmentId,
				},
				resumedFrom: suspendedId,
				history: pending.history,
				historyAvailable: pending.historyCursor > 0,
				ownershipGeneration: pending.ownerGeneration,
				ownershipLeaseExpiresAt: Date.now() + 45_000,
			};
		} catch (error) {
			this.rollbackSuspendedResume(record, pending);
			throw error;
		}
	}

	onPendingSuspendRevoked(
		workspaceId: string,
		attachmentId: string,
		listener: (reason: SuspendedRevocationReason) => void,
	): () => void {
		const pending = this.records.get(workspaceId)?.pendingSuspended;
		if (!pending || pending.newId !== workspaceId || pending.attachmentId !== attachmentId) {
			throw new WorkspaceFailure('not_found');
		}
		pending.revokedListeners.add(listener);
		return () => pending.revokedListeners.delete(listener);
	}

	startSuspendedAckDeadline(workspaceId: string, attachmentId: string): void {
		const record = this.records.get(workspaceId);
		const pending = record?.pendingSuspended;
		if (
			!pending ||
			record?.phase !== 'suspend_resuming' ||
			pending.newId !== workspaceId ||
			pending.attachmentId !== attachmentId
		) {
			throw new WorkspaceFailure('not_found');
		}
		clearTimeout(pending.timer);
		pending.timer = setTimeout(() => this.rollbackSuspendedResume(record, pending, 'lease_expired'), RESUME_ACK_MS);
		pending.timer.unref();
	}

	private rollbackSuspendedResume(
		record: WorkspaceRecord,
		pending: PendingSuspendedResume,
		reason?: SuspendedRevocationReason,
	): void {
		if (record.pendingSuspended !== pending) {
			return;
		}
		if (reason) {
			for (const listener of pending.revokedListeners) {
				try {
					listener(reason);
				} catch {
					/* revoke cannot fail rollback */
				}
			}
		}
		pending.revokedListeners.clear();
		clearTimeout(pending.timer);
		record.pendingSuspended = null;
		if (this.records.get(pending.newId) === record) {
			this.records.delete(pending.newId);
		}
		if (record.phase === 'closing' || record.phase === 'cleanup_unknown') {
			return;
		}
		record.phase = 'suspended';
		record.attachmentId = null;
		const mark = record.suspend;
		if (mark?.recording) {
			for (const bytes of pending.lateOutput) {
				this.appendSuspendedOutput(record, mark, bytes);
			}
		}
		if (record.suspend?.ownerId === pending.attachmentId) {
			record.suspend.ownerId = null;
			record.suspend.leaseExpiresAt = null;
		}
		this.publishSuspendedCatalogChanged(record.userId);
		// Queue overflow may have initiated closeRecord while replaying the
		// late chunks. Never undo its fail-closed pause on the same stack.
		if (
			record.phase !== 'suspended' ||
			mark?.failure !== null ||
			(mark?.queuedBytes ?? 0) > MAX_SUSPEND_PENDING_BYTES / 2 ||
			mark?.prepared
		) {
			return;
		}
		if (record.shellId && this.shells.get(record.shellId)) {
			try {
				this.shells.resumeOutput(record.shellId);
			} catch (error) {
				if (mark) {
					this.failSuspendedRecording(record, mark, error);
				} else {
					void this.closeRecord(record, 'disconnected').catch(() => undefined);
				}
			}
		}
	}

	async acknowledgeSuspendedResume(
		token: string | null,
		newId: string,
		attachmentId: string,
		suspendedId: string,
		nextToken: string,
		generation: number,
		ownerGeneration: number,
	): Promise<void> {
		const userId = await this.identity(token);
		const record = this.records.get(newId);
		const mark = record?.suspend;
		const pending = record?.pendingSuspended;
		if (
			!token ||
			!record ||
			!mark ||
			!pending ||
			!this.accepting ||
			record.phase !== 'suspend_resuming' ||
			record.userId !== userId ||
			mark.id !== suspendedId ||
			pending.attachmentId !== attachmentId ||
			pending.newId !== newId ||
			pending.nextToken !== nextToken ||
			pending.nextGeneration !== generation ||
			pending.ownerGeneration !== ownerGeneration ||
			!this.tokens.matches(token, pending.tokenHash) ||
			mark.failure !== null
		) {
			throw new WorkspaceFailure('not_found');
		}
		clearTimeout(pending.timer);
		pending.revokedListeners.clear();
		if (mark.retentionTimer) {
			clearTimeout(mark.retentionTimer);
		}
		mark.retentionTimer = null;
		record.pendingSuspended = null;
		record.resumeToken = nextToken;
		record.generation = generation;
		record.tokenHash = pending.tokenHash;
		record.lastConnectedAt = Math.floor(Date.now() / 1000);
		record.id = newId;
		if (this.records.get(pending.oldId) === record) {
			this.records.delete(pending.oldId);
		}
		record.phase = 'attached';
		mark.generation = ownerGeneration;
		mark.ownerId = attachmentId;
		mark.leaseExpiresAt = Date.now() + 45_000;
		this.publishSuspendedCatalogChanged(record.userId);
		record.output = [...(pending.history.length ? [pending.history] : []), ...pending.lateOutput];
		record.outputBytes = pending.history.length + pending.lateBytes;
		record.offset = record.outputBytes;
		for (const bytes of pending.lateOutput) {
			this.appendSuspendedOutput(record, mark, bytes);
		}
		record.historyCursor = {
			current: pending.historyCursor,
			latest: pending.historyCursor,
			suspendedId,
			tail: Promise.resolve(),
		};
		// Keep the shell paused until the replacement WS has bound its live
		// output listeners and queue. Only then is it safe to unfreeze delivery.
		this.reconcileFilesAfterResume(record, token, attachmentId);
	}

	finishSuspendedResume(id: string, attachmentId: string): void {
		const record = this.records.get(id);
		if (!record || record.phase !== 'attached' || record.attachmentId !== attachmentId) {
			throw new WorkspaceFailure('not_found');
		}
		// A resume ACK is not a terminal.flow consumption ACK.
		this.resumeIfUnblocked(record);
	}

	async suspendHistoryPrevious(
		token: string | null,
		id: string,
		attachmentId: string,
		deliver: (data: Uint8Array) => Promise<void>,
		maxBytes = WORKSPACE_SUSPEND_MAX_HISTORY_PAGE_BYTES,
	): Promise<{ hasMore: boolean }> {
		if (!this.logs || !(await this.allowed(token, id, attachmentId))) {
			throw new WorkspaceFailure('not_found');
		}
		const record = this.record(id);
		const cursor = record.historyCursor;
		if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > WORKSPACE_SUSPEND_MAX_HISTORY_PAGE_BYTES) {
			throw new WorkspaceFailure('invalid_input');
		}
		if (!cursor) {
			await deliver(new Uint8Array());
			return { hasMore: false };
		}
		const preceding = cursor.tail;
		let release!: () => void;
		cursor.tail = new Promise<void>((resolve) => {
			release = resolve;
		});
		await preceding;
		try {
			if (record.historyCursor !== cursor || !(await this.allowed(token, id, attachmentId))) {
				throw new WorkspaceFailure('not_found');
			}
			if (cursor.current <= 0) {
				await deliver(new Uint8Array());
				return { hasMore: false };
			}
			const page = await this.logs.readBefore(cursor.suspendedId, cursor.current, maxBytes);
			if (record.historyCursor !== cursor || !(await this.allowed(token, id, attachmentId))) {
				throw new WorkspaceFailure('not_found');
			}
			// The cursor is a delivery transaction: a failed/cancelled WS
			// binary send must not permanently consume the history page.
			await deliver(page.data);
			if (record.historyCursor !== cursor || !(await this.allowed(token, id, attachmentId))) {
				throw new WorkspaceFailure('not_found');
			}
			cursor.current = page.startOffset;
			return { hasMore: cursor.current > page.oldestOffset };
		} finally {
			release();
		}
	}

	async resetSuspendHistory(token: string | null, id: string, attachmentId: string): Promise<boolean> {
		if (!(await this.allowed(token, id, attachmentId))) {
			throw new WorkspaceFailure('not_found');
		}
		const cursor = this.record(id).historyCursor;
		if (!cursor || cursor.latest <= 0) {
			return false;
		}
		const preceding = cursor.tail;
		let release!: () => void;
		cursor.tail = new Promise<void>((resolve) => {
			release = resolve;
		});
		await preceding;
		try {
			if (!(await this.allowed(token, id, attachmentId)) || this.record(id).historyCursor !== cursor) {
				throw new WorkspaceFailure('not_found');
			}
			cursor.current = cursor.latest;
			return true;
		} finally {
			release();
		}
	}

	async listSuspended(token: string | null): Promise<SuspendedWorkspaceView[]> {
		const userId = await this.identity(token);
		const active: SuspendedWorkspaceView[] = [...this.suspended.values()].flatMap<SuspendedWorkspaceView>(
			(record) => {
				const mark = record.suspend;
				if (
					!mark ||
					record.userId !== userId ||
					record.phase === 'closing' ||
					record.phase === 'cleanup_unknown'
				) {
					return [];
				}
				const leaseActive =
					mark.ownerId !== null && mark.leaseExpiresAt !== null && mark.leaseExpiresAt > Date.now();
				return [
					{
						id: mark.id,
						originalWorkspaceId: mark.originalId,
						connectionId: record.connectionId,
						connectionName: record.connectionName,
						suspendedAt: new Date(mark.since).toISOString(),
						...(mark.customName === null ? {} : { customName: mark.customName }),
						status: 'active',
						ownershipState:
							record.phase === 'suspend_resuming'
								? 'resuming'
								: record.phase === 'suspended' || !leaseActive
									? 'available'
									: 'attached',
						ownershipGeneration: mark.generation,
						...(mark.leaseExpiresAt === null || !leaseActive
							? {}
							: { ownershipLeaseExpiresAt: mark.leaseExpiresAt }),
						...(!leaseActive ? {} : { attachedWorkspaceId: record.id }),
					},
				];
			},
		);
		const disconnected: SuspendedWorkspaceView[] = [...this.disconnected].flatMap<SuspendedWorkspaceView>(
			([id, tombstone]) => {
				if (tombstone.userId !== userId) {
					return [];
				}
				const mark = tombstone.mark;
				return [
					{
						id,
						originalWorkspaceId: mark.originalId,
						connectionId: tombstone.connectionId,
						connectionName: tombstone.connectionName,
						suspendedAt: new Date(mark.since).toISOString(),
						...(mark.customName === null ? {} : { customName: mark.customName }),
						status: 'disconnected',
						ownershipState: 'available',
						ownershipGeneration: mark.generation,
						disconnectedAt: new Date(tombstone.disconnectedAt).toISOString(),
					},
				];
			},
		);
		return [...active, ...disconnected];
	}

	async renameSuspended(token: string | null, suspendedId: string, name: string): Promise<void> {
		const userId = await this.identity(token);
		if (
			typeof name !== 'string' ||
			name.length > WORKSPACE_SUSPEND_MAX_NAME_CHARACTERS ||
			/[\u0000-\u001f\u007f-\u009f]/u.test(name)
		) {
			throw new WorkspaceFailure('invalid_input');
		}
		const record = this.suspended.get(suspendedId);
		if (
			record &&
			record.userId === userId &&
			record.suspend &&
			record.phase !== 'closing' &&
			record.phase !== 'cleanup_unknown'
		) {
			record.suspend.customName = name.trim() || null;
			this.publishSuspendedCatalogChanged(userId);
			return;
		}
		const tombstone = this.disconnected.get(suspendedId);
		if (!tombstone || tombstone.userId !== userId) {
			throw new WorkspaceFailure('not_found');
		}
		tombstone.mark.customName = name.trim() || null;
		this.publishSuspendedCatalogChanged(userId);
	}

	async terminateSuspended(token: string | null, suspendedId: string): Promise<boolean> {
		const userId = await this.identity(token);
		const record = this.suspended.get(suspendedId);
		if (record && record.userId === userId && record.suspend) {
			await this.closeRecord(record);
			return true;
		}
		return this.removeTombstone(userId, suspendedId);
	}

	async removeSuspended(token: string | null, suspendedId: string): Promise<SuspendedRemovalDisposition | null> {
		const userId = await this.identity(token);
		const record = this.suspended.get(suspendedId);
		if (!record || record.userId !== userId || !record.suspend) {
			return (await this.removeTombstone(userId, suspendedId)) ? 'removed' : null;
		}
		const mark = record.suspend;
		if (mark.unmarking) {
			await mark.unmarking;
			return 'unmarked';
		}
		if (mark.prepared) {
			throw new WorkspaceFailure('conflict');
		}
		if (record.phase === 'attached') {
			if (!record.attachmentId || !this.hasCurrentSuspendedLease(record)) {
				throw new WorkspaceFailure('conflict');
			}
			await this.clearSuspendedMark(record, mark);
			return 'unmarked';
		}
		if (record.phase !== 'suspended') {
			throw new WorkspaceFailure('conflict');
		}
		await this.closeRecord(record);
		return 'terminated';
	}

	async removeDisconnectedSuspended(token: string | null, suspendedId: string): Promise<boolean> {
		return this.removeTombstone(await this.identity(token), suspendedId);
	}

	private async removeTombstone(userId: number, id: string): Promise<boolean> {
		const tombstone = this.disconnected.get(id);
		if (!tombstone || tombstone.userId !== userId) {
			return false;
		}
		if (!this.logs) {
			throw new WorkspaceFailure('remote_unavailable');
		}
		try {
			await this.settleExports(id);
			await this.logs.delete(id);
		} catch (error) {
			const failure = new RemoteResourceCleanupFailure([error]);
			this.recordFailure(failure);
			throw new WorkspaceFailure('operation_unknown', { cause: failure });
		}
		if (this.disconnected.get(id) === tombstone) {
			clearTimeout(tombstone.timer);
			this.disconnected.delete(id);
			this.publishSuspendedCatalogChanged(userId);
		}
		return true;
	}

	deliverSuspendedLog(
		token: string | null,
		suspendedId: string,
		delivery: WorkspaceLogDelivery,
		signal?: AbortSignal,
	): Promise<boolean> {
		if (!this.accepting) {
			throw new WorkspaceFailure('remote_unavailable');
		}
		if (this.exports.size >= 2) {
			throw new WorkspaceFailure('limit_exceeded');
		}
		const controller = new AbortController();

		const abort = () => controller.abort(signal?.reason);

		signal?.addEventListener('abort', abort, { once: true });
		if (signal?.aborted) {
			abort();
		}
		const timer = setTimeout(() => controller.abort(new WorkspaceFailure('remote_unavailable')), 60_000);
		timer.unref();
		// Reserve before authentication or any renderer can start.
		let cleanupFailed = false;
		const task = Promise.resolve()
			.then(() => this.exportSuspendedLog(token, suspendedId, delivery, controller.signal))
			.catch((error) => {
				if (error instanceof RemoteResourceCleanupFailure) {
					cleanupFailed = true;
					this.recordFailure(error);
				}
				throw error;
			})
			.finally(() => {
				clearTimeout(timer);
				signal?.removeEventListener('abort', abort);
				if (!cleanupFailed) {
					this.exports.delete(controller);
				}
			});
		this.exports.set(controller, { id: suspendedId, task });
		this.track(task);
		return this.untilAbort(task, controller.signal);
	}

	private async exportSuspendedLog(
		token: string | null,
		suspendedId: string,
		delivery: WorkspaceLogDelivery,
		signal: AbortSignal,
	): Promise<boolean> {
		const userId = await this.identity(token);
		signal.throwIfAborted();
		const record = this.suspended.get(suspendedId);
		const tombstone = this.disconnected.get(suspendedId);
		const mark = record?.suspend;
		const history = this.logs;
		if (!history) {
			return false;
		}
		let view: WorkspaceViewport;
		if (record && record.userId === userId && mark && mark.failure === null) {
			await this.untilAbort(mark.tail, signal);
			view = { columns: mark.viewport.columns, rows: mark.viewport.rows };
		} else if (tombstone && tombstone.userId === userId) {
			view = { columns: tombstone.mark.viewport.columns, rows: tombstone.mark.viewport.rows };
		} else {
			return false;
		}

		const current = () =>
			this.accepting &&
			!signal.aborted &&
			(record
				? this.suspended.get(suspendedId) === record &&
					record.suspend === mark &&
					record.phase !== 'closing' &&
					record.phase !== 'cleanup_unknown'
				: this.disconnected.get(suspendedId) === tombstone);

		if (!current()) {
			throw new WorkspaceFailure('not_found');
		}
		const source = await history.openText(suspendedId, view, signal);
		let failure: unknown = null;
		try {
			if ((await this.identity(token)) !== userId || !current()) {
				throw new WorkspaceFailure('not_found');
			}

			const identity = () => this.untilAbort(this.identity(token), signal);

			const bytes = (async function* () {
				let deliveredBytes = 0;
				for await (const chunk of source.bytes) {
					signal.throwIfAborted();
					if ((await identity()) !== userId || !current()) {
						throw new WorkspaceFailure('not_found');
					}
					deliveredBytes += chunk.byteLength;
					if (deliveredBytes > SUSPENDED_LOG_MAX_BYTES) {
						throw new WorkspaceFailure('limit_exceeded');
					}
					yield chunk;
				}
			})();
			await delivery.deliver(suspendedId + '.txt', bytes, signal);
			if ((await this.identity(token)) !== userId || !current()) {
				throw new WorkspaceFailure('not_found');
			}
		} catch (error) {
			failure = error;
		}
		try {
			await source.release();
		} catch (cleanup) {
			const error = new RemoteResourceCleanupFailure(failure === null ? [cleanup] : [failure, cleanup]);
			this.recordFailure(error);
			throw error;
		}
		if (failure !== null) {
			throw failure;
		}
		return true;
	}

	private cancelExports(id: string): Promise<unknown>[] {
		const tasks: Promise<unknown>[] = [];
		for (const [controller, entry] of this.exports) {
			if (entry.id !== id) {
				continue;
			}
			controller.abort(new WorkspaceFailure('not_found'));
			tasks.push(entry.task);
		}
		return tasks;
	}

	private async settleExports(id: string): Promise<void> {
		const result = await this.cleanupOutcome(
			this.confirmTaskCleanup(this.cancelExports(id)),
			Date.now() + CLOSE_CONFIRMATION_MS,
		);
		if (result.kind !== 'ok') {
			throw new RemoteResourceCleanupFailure([
				result.kind === 'failed' ? result.error : new WorkspaceFailure('operation_unknown'),
			]);
		}
	}

	private async confirmTaskCleanup(tasks: Promise<unknown>[]): Promise<void> {
		const outcomes = await Promise.allSettled(tasks);
		const failures: unknown[] = [];
		for (const outcome of outcomes) {
			// Cancellation rejects delivery even when its resources were released.
			// Only a confirmed cleanup failure prevents owner retirement.
			if (outcome.status === 'rejected' && outcome.reason instanceof RemoteResourceCleanupFailure) {
				failures.push(outcome.reason);
			}
		}
		if (failures.length) {
			throw new RemoteResourceCleanupFailure(failures);
		}
	}

	async renewSuspendedOwner(
		token: string | null,
		id: string,
		attachmentId: string,
	): Promise<{ generation: number; leaseExpiresAt: number }> {
		if (!(await this.allowed(token, id, attachmentId))) {
			throw new WorkspaceFailure('not_found');
		}
		const mark = this.record(id).suspend;
		if (!mark || mark.ownerId !== attachmentId || !mark.leaseExpiresAt || mark.leaseExpiresAt <= Date.now()) {
			throw new WorkspaceFailure('conflict');
		}
		mark.leaseExpiresAt = Date.now() + 45_000;
		this.publishSuspendedCatalogChanged(this.record(id).userId);
		return { generation: mark.generation, leaseExpiresAt: mark.leaseExpiresAt };
	}

	private credentials(record: WorkspaceRecord, resume: string, generation: number): void {
		if (record.resumeToken !== resume || record.generation !== generation) {
			throw new WorkspaceFailure('not_found');
		}
	}

	private clearDetachTimer(record: WorkspaceRecord): void {
		if (record.detachTimer) {
			clearTimeout(record.detachTimer);
		}
		record.detachTimer = null;
	}

	private startGrace(record: WorkspaceRecord): void {
		this.clearDetachTimer(record);
		record.detachTimer = setTimeout(() => {
			if (record.phase === 'detached' && this.records.get(record.id) === record) {
				void this.closeRecord(record).catch(() => undefined);
			}
		}, DETACH_GRACE_MS);
		record.detachTimer.unref();
	}

	async resume(
		token: string | null,
		id: string,
		connectionId: number,
		resume: string,
		generation: number,
		offset: number,
	): Promise<WorkspaceReplay> {
		const userId = await this.identity(token);
		if (!token || !this.accepting) {
			throw new WorkspaceFailure('remote_unavailable');
		}
		const record = this.record(id);
		if (record.userId !== userId || record.connectionId !== connectionId) {
			throw new WorkspaceFailure('not_found');
		}
		this.credentials(record, resume, generation);
		if (record.phase !== 'detached' || !record.shellId || this.shells.get(record.shellId) === null) {
			throw new WorkspaceFailure('conflict');
		}
		if (!Number.isSafeInteger(offset) || offset < record.offset - record.outputBytes || offset > record.offset) {
			throw new WorkspaceFailure('invalid_input');
		}
		const attachmentId = randomUUID();
		const pending: PendingResume = {
			attachmentId,
			tokenHash: this.tokens.digest(token),
			nextToken: this.tokens.issue(),
			nextGeneration: record.generation + 1,
			timer: setTimeout(() => this.detach(id, attachmentId), RESUME_ACK_MS),
		};
		pending.timer.unref();
		record.pendingResume = pending;
		record.attachmentId = attachmentId;
		record.phase = 'resuming';
		this.clearDetachTimer(record);
		const skip = offset - (record.offset - record.outputBytes);
		const replay = Buffer.concat(record.output.map((bytes) => Buffer.from(bytes))).subarray(skip);
		return {
			lease: {
				...this.lease(record),
				resumeToken: pending.nextToken,
				attachmentGeneration: pending.nextGeneration,
			},
			replay: Uint8Array.from(replay),
			replayedBytes: replay.length,
		};
	}

	replayFrom(id: string, attachmentId: string, offset: number): Uint8Array {
		const record = this.record(id);
		if (
			record.attachmentId !== attachmentId ||
			!Number.isSafeInteger(offset) ||
			offset < record.offset - record.outputBytes ||
			offset > record.offset
		) {
			throw new WorkspaceFailure('invalid_input');
		}
		const skip = offset - (record.offset - record.outputBytes);
		return Uint8Array.from(Buffer.concat(record.output.map((bytes) => Buffer.from(bytes))).subarray(skip));
	}

	/** An initial socket attaches after SSH shell opening. Retain and replay
	 * its greeting bytes rather than dropping output emitted before WS bind. */
	retainedTail(id: string, attachmentId: string): { bytes: Uint8Array; endOffset: number } {
		const record = this.record(id);
		if (record.phase !== 'attached' || record.attachmentId !== attachmentId) {
			throw new WorkspaceFailure('not_found');
		}
		return {
			bytes: Uint8Array.from(Buffer.concat(record.output.map((bytes) => Buffer.from(bytes)))),
			endOffset: record.offset,
		};
	}

	async acknowledge(
		token: string | null,
		id: string,
		attachmentId: string,
		nextToken: string,
		generation: number,
		replayOffset: number,
		onOutput: (output: WorkspaceOutput) => void,
		onClosed: (reason: SessionCloseReason) => void,
	): Promise<{ replay: Uint8Array; dispose: () => void }> {
		const userId = await this.identity(token);
		const record = this.record(id);
		const pending = record.pendingResume;
		if (
			record.phase !== 'resuming' ||
			!token ||
			record.userId !== userId ||
			!pending ||
			!this.tokens.matches(token, pending.tokenHash) ||
			pending.attachmentId !== attachmentId ||
			pending.nextToken !== nextToken ||
			pending.nextGeneration !== generation
		) {
			throw new WorkspaceFailure('not_found');
		}
		// The replay cursor is checked against actual retained bytes before
		// changing ownership. Late output cannot reorder or erase a failed ACK.
		const replay = this.replayFrom(id, attachmentId, replayOffset);
		record.outputListeners.add(onOutput);
		record.closedListeners.add(onClosed);
		clearTimeout(pending.timer);
		record.resumeToken = nextToken;
		record.generation = generation;
		record.tokenHash = pending.tokenHash;
		record.pendingResume = null;
		record.phase = 'attached';
		record.lastConnectedAt = Math.floor(Date.now() / 1000);
		if (record.file && record.fileTokenHash !== pending.tokenHash) {
			// A different login must not momentarily expose a ready FileResource
			// belonging to the previous login while refresh is in flight.
			this.publishFileState(record, { kind: 'opening' });
		}
		this.reconcileFilesAfterResume(record, token, attachmentId);
		return {
			replay,

			dispose: () => {
				record.outputListeners.delete(onOutput);
				record.closedListeners.delete(onClosed);
			},
		};
	}

	async runMachineTask<T>(
		token: string | null,
		id: string,
		attachmentId: string,
		operation: (scope: WorkspaceMachineTaskScope) => Promise<T>,
		signal: AbortSignal,
	): Promise<T> {
		if (!(await this.allowed(token, id, attachmentId))) {
			throw new WorkspaceFailure('not_found');
		}
		const record = this.record(id);
		const shell = record.shellId ? this.shells.get(record.shellId) : null;
		if (!shell) {
			throw new WorkspaceFailure('not_found');
		}
		const controller = new AbortController();

		const abort = () => controller.abort(new WorkspaceFailure('not_found'));

		signal.addEventListener('abort', abort, { once: true });
		record.controller.signal.addEventListener('abort', abort, { once: true });
		if (signal.aborted || record.controller.signal.aborted) {
			abort();
		}
		const entries = this.machineTasks.get(record) ?? new Map<AbortController, Promise<unknown>>();
		this.machineTasks.set(record, entries);
		let cleanupFailed = false;
		const task = Promise.resolve()
			.then(() =>
				operation({
					targetId: record.connectionId,
					fingerprint: shell.fingerprint,
					signal: controller.signal,

					validate: async () => {
						controller.signal.throwIfAborted();
						if (!(await this.allowed(token, id, attachmentId)) || this.records.get(id) !== record) {
							throw new WorkspaceFailure('not_found');
						}
						controller.signal.throwIfAborted();
					},
				}),
			)
			.catch((error) => {
				if (error instanceof RemoteResourceCleanupFailure) {
					cleanupFailed = true;
					this.recordFailure(error);
				}
				throw error;
			})
			.finally(() => {
				signal.removeEventListener('abort', abort);
				record.controller.signal.removeEventListener('abort', abort);
				if (!cleanupFailed) {
					entries.delete(controller);
					if (!entries.size && this.machineTasks.get(record) === entries) {
						this.machineTasks.delete(record);
					}
				}
			});
		entries.set(controller, task);
		return this.track(task);
	}

	private cancelMachineTasks(record: WorkspaceRecord): Promise<unknown>[] {
		const entries = this.machineTasks.get(record);
		if (!entries) {
			return [];
		}
		for (const controller of entries.keys()) {
			controller.abort(new WorkspaceFailure('not_found'));
		}
		return [...entries.values()];
	}

	detach(id: string, attachmentId: string): void {
		const record = this.records.get(id);
		if (!record || record.attachmentId !== attachmentId) {
			return;
		}
		this.cancelMachineTasks(record);
		if (record.phase === 'suspend_resuming' && record.pendingSuspended) {
			this.rollbackSuspendedResume(record, record.pendingSuspended);
			return;
		}
		if (record.phase !== 'resuming' && record.phase !== 'attached') {
			return;
		}
		// Unsent input belongs to this attachment; a later owner cannot inherit it.
		record.input.length = 0;
		record.inputBytes = 0;
		try {
			record.shellIntegration?.onAttachmentReleased();
		} catch (cause) {
			this.recordFailure(new RemoteResourceCleanupFailure([cause]));
			void this.closeRecord(record, 'disconnected').catch(() => undefined);
			return;
		}
		if (record.pendingResume) {
			clearTimeout(record.pendingResume.timer);
		}
		record.pendingResume = null;
		record.attachmentId = null;
		record.outputListeners.clear();
		record.directoryListeners.clear();
		record.fileListeners.clear();
		record.revokedListeners.clear();
		record.unmarkedListeners.clear();
		record.pauseByConsumer = false;
		const mark = record.suspend;
		const retained = mark !== null && mark.recording && mark.failure === null;
		record.phase = retained ? 'suspended' : 'detached';
		if (retained && mark) {
			mark.prepared = false;
		}
		if (retained && mark) {
			mark.ownerId = null;
			mark.leaseExpiresAt = null;
			this.publishSuspendedCatalogChanged(record.userId);
			this.publishFileState(record, { kind: 'opening' });
			mark.retentionTimer = setTimeout(() => {
				if ((record.phase === 'suspended' || record.phase === 'suspend_resuming') && record.suspend === mark) {
					void this.closeRecord(record).then(
						() => this.publishAutoTerminated(record.userId, mark.id, 'retention_expired'),
						() => undefined,
					);
				}
			}, SUSPENDED_RETENTION_MS);
			mark.retentionTimer.unref();
			// A detached SFTP lease serves no socket. Retire it without releasing
			// the PTY, and serialize against any in-flight SFTP opening.
			const previous = record.fileTask ?? Promise.resolve();
			record.fileTask = this.track(
				previous
					.then(async () => {
						const resource = record.file;
						if (!resource) {
							return;
						}
						record.file = null;
						record.fileTokenHash = null;
						await resource.release();
					})
					.catch((error) => {
						const failure =
							error instanceof RemoteResourceCleanupFailure
								? error
								: new RemoteResourceCleanupFailure([error]);
						record.fileFailure = failure;
						this.recordFailure(failure);
						if (record.phase !== 'closing' && record.phase !== 'cleanup_unknown') {
							this.publishFileState(record, { kind: 'failed', reason: 'operation_unknown' });
						}
					}),
			);
		} else {
			this.startGrace(record);
		}
		// An SSH adapter can throw while unpausing a dying PTY. Finalize owner
		// revocation/retention and independent File cleanup first, then fail
		// closed instead of leaving a half-detached lease with no timer.
		if (
			record.shellId &&
			this.shells.get(record.shellId) &&
			(!retained || (mark !== null && mark.queuedBytes <= MAX_SUSPEND_PENDING_BYTES / 2))
		) {
			try {
				this.shells.resumeOutput(record.shellId);
			} catch (error) {
				if (retained && mark) {
					this.failSuspendedRecording(record, mark, error);
				} else {
					this.recordFailure(error);
					void this.closeRecord(record, 'disconnected').catch(() => undefined);
				}
			}
		}
	}

	private hasCurrentSuspendedLease(record: WorkspaceRecord): boolean {
		const mark = record.suspend;
		return (
			!mark ||
			record.phase !== 'attached' ||
			(mark.ownerId === record.attachmentId && mark.leaseExpiresAt !== null && mark.leaseExpiresAt > Date.now())
		);
	}

	async allowed(
		token: string | null,
		id: string,
		attachmentId: string,
		allowPendingResume = false,
	): Promise<boolean> {
		if (!token) {
			return false;
		}
		const record = this.records.get(id);

		const allowedPhase = (phase: WorkspacePhase): boolean =>
			phase === 'attached' || (allowPendingResume && (phase === 'resuming' || phase === 'suspend_resuming'));

		if (!record || !allowedPhase(record.phase) || record.attachmentId !== attachmentId) {
			return false;
		}

		if (!this.hasCurrentSuspendedLease(record)) {
			return false;
		}
		const expectedHash =
			record.phase === 'resuming'
				? record.pendingResume?.tokenHash
				: record.phase === 'suspend_resuming'
					? record.pendingSuspended?.tokenHash
					: record.tokenHash;
		if (!expectedHash || !this.tokens.matches(token, expectedHash)) {
			return false;
		}
		try {
			return (
				(await this.identity(token)) === record.userId &&
				this.records.get(id) === record &&
				record.attachmentId === attachmentId &&
				allowedPhase(record.phase) &&
				this.hasCurrentSuspendedLease(record) &&
				this.accepting
			);
		} catch {
			return false;
		}
	}

	onOutput(id: string, attachmentId: string, listener: (item: WorkspaceOutput) => void): () => void {
		const record = this.record(id);
		if (record.attachmentId !== attachmentId) {
			throw new WorkspaceFailure('not_found');
		}
		record.outputListeners.add(listener);
		return () => record.outputListeners.delete(listener);
	}

	onClosed(id: string, attachmentId: string, listener: (reason: SessionCloseReason) => void): () => void {
		const record = this.record(id);
		if (record.attachmentId !== attachmentId) {
			throw new WorkspaceFailure('not_found');
		}
		record.closedListeners.add(listener);
		return () => record.closedListeners.delete(listener);
	}

	onSuspensionRevoked(
		id: string,
		attachmentId: string,
		listener: (suspendedId: string, generation: number, reason: SuspendedRevocationReason) => void,
	): () => void {
		const record = this.record(id);
		if (record.attachmentId !== attachmentId) {
			throw new WorkspaceFailure('not_found');
		}
		record.revokedListeners.add(listener);
		return () => record.revokedListeners.delete(listener);
	}

	onDirectoryEvent(id: string, attachmentId: string, listener: (event: WorkspaceDirectoryEvent) => void): () => void {
		const record = this.record(id);
		if (record.attachmentId !== attachmentId) {
			throw new WorkspaceFailure('not_found');
		}
		record.directoryListeners.add(listener);
		return () => record.directoryListeners.delete(listener);
	}

	onSuspensionUnmarked(
		id: string,
		attachmentId: string,
		listener: (suspendedId: string, generation: number) => void,
	): () => void {
		const record = this.record(id);
		if (record.attachmentId !== attachmentId) {
			throw new WorkspaceFailure('not_found');
		}
		record.unmarkedListeners.add(listener);
		return () => record.unmarkedListeners.delete(listener);
	}

	onFileState(id: string, attachmentId: string, listener: (state: WorkspaceFileState) => void): () => void {
		const record = this.record(id);
		if (record.attachmentId !== attachmentId) {
			throw new WorkspaceFailure('not_found');
		}
		record.fileListeners.add(listener);
		try {
			listener(record.fileState);
		} catch (error) {
			record.fileListeners.delete(listener);
			throw error;
		}
		return () => record.fileListeners.delete(listener);
	}

	async currentDirectory(
		token: string | null,
		id: string,
		attachmentId: string,
		signal?: AbortSignal,
	): Promise<string> {
		if (!(await this.allowed(token, id, attachmentId))) {
			throw new WorkspaceFailure('not_found');
		}
		const integration = this.record(id).shellIntegration;
		if (!integration) {
			throw new WorkspaceFailure('remote_unavailable');
		}
		const current = await integration.currentDirectory(signal);
		if (!(await this.allowed(token, id, attachmentId))) {
			throw new WorkspaceFailure('not_found');
		}
		return current;
	}

	async changeDirectory(
		token: string | null,
		id: string,
		attachmentId: string,
		requestId: string,
		path: string,
		signal?: AbortSignal,
	): Promise<void> {
		if (!(await this.allowed(token, id, attachmentId))) {
			throw new WorkspaceFailure('not_found');
		}
		const integration = this.record(id).shellIntegration;
		if (!integration) {
			throw new WorkspaceFailure('remote_unavailable');
		}
		await integration.changeDirectory(
			requestId,
			path,
			signal,
			() =>
				this.records.get(id)?.attachmentId === attachmentId &&
				this.records.get(id)?.phase === 'attached' &&
				!signal?.aborted,
		);
		if (!(await this.allowed(token, id, attachmentId))) {
			throw new WorkspaceFailure('not_found');
		}
	}

	write(id: string, attachmentId: string, text: string): void {
		const record = this.record(id);
		if (record.phase !== 'attached' || record.attachmentId !== attachmentId || !record.shellId) {
			throw new WorkspaceFailure('not_found');
		}
		const bytes = Buffer.from(text, 'utf8');
		if (bytes.length > WORKSPACE_TERMINAL_MAX_INPUT_BYTES) {
			throw new WorkspaceFailure('invalid_input');
		}
		if (record.inputBytes + bytes.length > WORKSPACE_TERMINAL_MAX_IN_FLIGHT_BYTES) {
			throw new WorkspaceFailure('limit_exceeded');
		}
		record.shellIntegration?.noteUserInput();
		record.input.push({ bytes });
		record.inputBytes += bytes.length;
		this.drainInput(record);
	}

	private drainInput(record: WorkspaceRecord): void {
		if (record.waitingDrain || !record.shellId) {
			return;
		}
		while (record.input.length) {
			const next = record.input[0];
			if (!next) {
				return;
			}
			const accepted = this.shells.write(record.shellId, next.bytes);
			record.input.shift();
			record.inputBytes -= next.bytes.length;
			if (!accepted) {
				record.waitingDrain = true;

				let off: () => void = () => undefined;

				off = this.shells.onDrain(record.shellId, () => {
					try {
						off();
					} catch (cause) {
						this.recordFailure(new RemoteResourceCleanupFailure([cause]));
						void this.closeRecord(record, 'disconnected').catch(() => undefined);
						return;
					}
					const index = record.subscribers.indexOf(off);
					if (index !== -1) {
						record.subscribers.splice(index, 1);
					}
					record.waitingDrain = false;
					if (record.phase === 'attached') {
						this.drainInput(record);
					}
				});
				record.subscribers.push(off);
				return;
			}
		}
	}

	resize(id: string, attachmentId: string, columns: number, rows: number): void {
		const record = this.record(id);
		if (record.phase !== 'attached' || record.attachmentId !== attachmentId || !record.shellId) {
			throw new WorkspaceFailure('not_found');
		}
		this.shells.resize(record.shellId, columns, rows);
		record.viewport = { columns, rows };
		if (record.suspend?.checkpoint) {
			const mark = record.suspend;
			mark.viewport = record.viewport;
			mark.tail = mark.tail.then(async () => {
				try {
					await mark.checkpoint?.resize(record.viewport);
				} catch {
					await mark.checkpoint?.dispose();
					mark.checkpoint = null;
				}
			});
		}
	}

	pause(id: string): void {
		const record = this.records.get(id);
		if (record?.shellId && record.phase === 'attached' && this.shells.get(record.shellId)) {
			record.pauseByConsumer = true;
			this.shells.pauseOutput(record.shellId);
		}
	}

	private resumeIfUnblocked(record: WorkspaceRecord): void {
		if (
			record.phase !== 'attached' ||
			record.pauseByConsumer ||
			record.suspend?.prepared ||
			(record.suspend?.queuedBytes ?? 0) > MAX_SUSPEND_PENDING_BYTES / 2
		) {
			return;
		}
		const shellId = record.shellId;
		if (shellId && this.shells.get(shellId)) {
			this.shells.resumeOutput(shellId);
		}
	}

	resumeOutput(id: string): void {
		const record = this.records.get(id);
		if (record?.phase !== 'attached') {
			return;
		}
		record.pauseByConsumer = false;
		this.resumeIfUnblocked(record);
	}

	async closeAuthorized(
		token: string | null,
		id: string,
		attachmentId: string,
		connectionId: number,
		resume: string,
		generation: number,
	): Promise<void> {
		if (!(await this.allowed(token, id, attachmentId))) {
			throw new WorkspaceFailure('not_found');
		}
		const record = this.record(id);
		if (record.connectionId !== connectionId) {
			throw new WorkspaceFailure('not_found');
		}
		this.credentials(record, resume, generation);
		await this.closeRecord(record);
	}

	/** A separate authenticated socket may close a *detached* Workspace only
	 * with its exact resumable capability. It must never revoke an attached
	 * owner or a retained suspended session through this route.
	 */
	async closeDetachedAuthorized(
		token: string | null,
		id: string,
		connectionId: number,
		resume: string,
		generation: number,
	): Promise<void> {
		const userId = await this.identity(token);
		if (!token || !this.accepting) {
			throw new WorkspaceFailure('remote_unavailable');
		}
		const record = this.record(id);
		if (record.userId !== userId || record.connectionId !== connectionId) {
			throw new WorkspaceFailure('not_found');
		}
		this.credentials(record, resume, generation);
		if (record.phase !== 'detached' || record.attachmentId !== null) {
			throw new WorkspaceFailure('conflict');
		}
		await this.closeRecord(record);
	}

	/** Only the opening WS owns this exact opaque attachment ID; on failure it
	 * must close rather than put an unacknowledged shell into the grace pool. */
	closeFailedAttachment(id: string, attachmentId: string): Promise<void> {
		const record = this.records.get(id);
		if (!record || record.attachmentId !== attachmentId) {
			return Promise.resolve();
		}
		return this.closeRecord(record);
	}

	private closeRecord(record: WorkspaceRecord, reason: SessionCloseReason = 'closed_by_owner'): Promise<void> {
		if (record.closePromise) {
			return record.closePromise;
		}
		const closing = Promise.resolve().then(() => this.closeRecordOwned(record, reason));
		record.closePromise = closing;
		record.phase = 'closing';
		if (record.suspend) {
			this.publishSuspendedCatalogChanged(record.userId);
		}
		return this.track(closing);
	}

	private async closeRecordOwned(record: WorkspaceRecord, reason: SessionCloseReason): Promise<void> {
		record.phase = 'closing';
		record.controller.abort(new Error('Workspace closing'));
		const failures: unknown[] = [];
		try {
			record.shellIntegration?.close();
		} catch (error) {
			failures.push(error);
		}
		const mark = record.suspend;
		const keepDisconnectedLog =
			mark !== null &&
			mark.recording &&
			mark.failure === null &&
			(reason === 'normal' || reason === 'disconnected');
		const pendingSuspended = record.pendingSuspended;
		if (pendingSuspended) {
			clearTimeout(pendingSuspended.timer);
			record.pendingSuspended = null;
		}
		if (mark) {
			mark.recording = false;
			if (mark.retentionTimer) {
				clearTimeout(mark.retentionTimer);
			}
			mark.retentionTimer = null;
		}
		this.clearDetachTimer(record);
		if (record.pendingResume) {
			clearTimeout(record.pendingResume.timer);
		}
		record.pendingResume = null;
		record.attachmentId = null;
		for (const listener of record.closedListeners) {
			try {
				listener(reason);
			} catch {
				/* closing must proceed */
			}
		}
		record.closedListeners.clear();
		record.revokedListeners.clear();
		record.unmarkedListeners.clear();
		record.outputListeners.clear();
		record.directoryListeners.clear();
		record.fileListeners.clear();
		{
			const deadline = Date.now() + CLOSE_CONFIRMATION_MS;
			const exports = mark ? this.cancelExports(mark.id) : [];
			const machineTasks = this.cancelMachineTasks(record);
			// Remove PTY observers before the close can dispose its underlying
			// event source. Opening can install late observers; sweep again below.
			failures.push(...releaseCallbacks(record.subscribers));

			const collect = (result: CleanupOutcome): boolean => {
				if (result.kind === 'timeout') {
					failures.push(new WorkspaceFailure('operation_unknown'));
					return false;
				}
				if (result.kind === 'failed') {
					failures.push(result.error);
					return false;
				}
				return true;
			};

			// Start terminal release before waiting for slow authentication/SFTP.
			// It does not depend on Files settlement and its rejection is observed now.
			const firstShellId = record.shellId;
			const shellClose = firstShellId
				? this.cleanupOutcome(
						Promise.resolve().then(() => this.shells.closeSession(firstShellId)),
						deadline,
					)
				: null;
			if (record.openPromise) {
				const opening = await this.cleanupOutcome(record.openPromise, deadline);
				if (opening.kind === 'timeout') {
					collect(opening);
				} else if (opening.kind === 'failed' && opening.error instanceof RemoteResourceCleanupFailure) {
					collect(opening);
				}
			}
			if (record.fileTask) {
				collect(await this.cleanupOutcome(record.fileTask, deadline));
			}
			if (record.fileFailure) {
				failures.push(record.fileFailure);
			}
			failures.push(...releaseCallbacks(record.subscribers));
			const releases: Array<Promise<CleanupOutcome>> = [];
			const fileToClose = record.file;
			if (fileToClose) {
				releases.push(
					this.cleanupOutcome(
						Promise.resolve().then(() => fileToClose.release()),
						deadline,
					),
				);
			}
			if (shellClose) {
				releases.push(shellClose);
			}
			if (record.shellId && record.shellId !== firstShellId) {
				const lateShellId = record.shellId;
				releases.push(
					this.cleanupOutcome(
						Promise.resolve().then(() => this.shells.closeSession(lateShellId)),
						deadline,
					),
				);
			}
			const completions = await Promise.all(releases);
			for (const outcome of completions) {
				collect(outcome);
			}
			if (exports.length) {
				const exported = await this.cleanupOutcome(this.confirmTaskCleanup(exports), deadline);
				collect(exported);
			}
			if (machineTasks.length) {
				collect(await this.cleanupOutcome(this.confirmTaskCleanup(machineTasks), deadline));
			}
			if (mark && this.logs) {
				let logsConfirmed = collect(await this.cleanupOutcome(mark.tail, deadline));
				if (logsConfirmed && pendingSuspended?.lateOutput.length) {
					for (const bytes of pendingSuspended.lateOutput) {
						if (!collect(await this.cleanupOutcome(this.logs.append(mark.id, bytes), deadline))) {
							logsConfirmed = false;
							break;
						}
					}
				}
				if (mark.checkpoint) {
					collect(await this.cleanupOutcome(mark.checkpoint.dispose(), deadline));
				}
				if (mark.failure !== null) {
					failures.push(mark.failure);
				}
				if (!keepDisconnectedLog && logsConfirmed) {
					collect(await this.cleanupOutcome(this.logs.delete(mark.id), deadline));
				}
			}
			record.input.length = 0;
			record.output.length = 0;
			if (failures.length) {
				const failure = new RemoteResourceCleanupFailure(failures);
				record.phase = 'cleanup_unknown';
				this.recordFailure(failure);
				throw failure;
			}
			for (const [key, owner] of this.records) {
				if (owner === record) {
					this.records.delete(key);
				}
			}
			if (mark && this.suspended.get(mark.id) === record) {
				this.suspended.delete(mark.id);
			}
			if (mark && keepDisconnectedLog) {
				const disconnectedAt = Date.now();
				const tombstone: SuspendedTombstone = {
					userId: record.userId,
					mark,
					connectionId: record.connectionId,
					connectionName: record.connectionName,
					disconnectedAt,
					timer: setTimeout(() => {
						if (this.disconnected.get(mark.id) !== tombstone) {
							return;
						}
						void this.removeTombstone(record.userId, mark.id).then(
							(removed) => {
								if (removed) {
									this.publishAutoTerminated(record.userId, mark.id, 'retention_expired');
								}
							},
							(error) => this.recordFailure(error),
						);
					}, SUSPENDED_RETENTION_MS),
				};
				tombstone.timer.unref();
				this.disconnected.set(mark.id, tombstone);
				this.publishSuspendedCatalogChanged(record.userId);
			}
		}
	}

	quiesce(): void {
		this.accepting = false;
		for (const controller of this.exports.keys()) {
			controller.abort(new WorkspaceFailure('remote_unavailable'));
		}
		for (const record of this.records.values()) {
			record.controller.abort(new Error('Workspace stopping'));
		}
	}

	close(): Promise<void> {
		if (this.closePromise) {
			return this.closePromise;
		}
		this.accepting = false;
		this.closePromise = Promise.resolve().then(() => this.closeOwned());
		return this.closePromise;
	}

	private async closeOwned(): Promise<void> {
		this.quiesce();
		clearInterval(this.leaseSweeper);
		for (const tombstone of this.disconnected.values()) {
			clearTimeout(tombstone.timer);
		}
		const deadline = Date.now() + CLOSE_CONFIRMATION_MS;
		const records = [...new Set(this.records.values())];
		const closing = await this.cleanupOutcome(
			Promise.allSettled(records.map((record) => this.closeRecord(record))),
			deadline,
		);
		if (closing.kind !== 'ok') {
			this.recordFailure(closing.kind === 'failed' ? closing.error : new WorkspaceFailure('operation_unknown'));
		}
		while (this.tasks.size) {
			const pending = await this.cleanupOutcome(Promise.allSettled([...this.tasks]), deadline);
			if (pending.kind !== 'ok') {
				this.recordFailure(
					pending.kind === 'failed' ? pending.error : new WorkspaceFailure('operation_unknown'),
				);
				break;
			}
		}
		const failures = this.failures.errors();
		if (failures.length) {
			throw new RemoteResourceCleanupFailure([...new Set(failures)]);
		}
	}
}
