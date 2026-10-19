import { WORKSPACE_ARCHIVE_TOOLS } from '@nexus-terminal/shared/remote/transfers/values';
import type { WorkspaceErrorCode } from '@nexus-terminal/shared/remote/workspace/values';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import { WORKSPACE_SUSPEND_MAX_JSON_BYTES } from '@nexus-terminal/shared/remote/suspend/values';
import { OBSERVATION_MAX_RESPONSE_BYTES } from '@nexus-terminal/shared/remote/monitoring/values';
import {
	InvalidWorkspaceDockerPayload,
	readWorkspaceDockerCommand,
	readWorkspaceDockerStats,
} from '@nexus-terminal/shared/remote/docker/workspace-codec';
import { readWorkspaceObservationEmpty } from '@nexus-terminal/shared/remote/monitoring/workspace-codec';
import { InvalidObservationPayload } from '@nexus-terminal/shared/remote/monitoring/http-codec';
import { ObservationFailure } from '../../monitoring/model/observation-types.js';
import type { WorkspaceObservationOwner } from '../../monitoring/model/observation-types.js';
import type { RemoteObservationService } from '../../monitoring/service/observation-service.js';
import { observedDockerStatus, observedDockerStats, observationSample } from '../observation-view.js';
import path from 'node:path';
import type { IncomingMessage } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import type { AccessPublicApi } from '../../../access/public.js';
import type { HttpWebSocketChannel, HttpWebSocketRoute } from '../../../../platform/http/http-types.js';
import { readRequestCookie } from '../../../../platform/http/http-request.js';
import type { RemoteFileService } from '../../files/service/file-service.js';
import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import type { FileUploadEvent } from '../../files/model/file-upload-types.js';
import type { WorkspaceService } from '../../sessions/service/workspace-service.js';
import { WorkspaceFailure, type WorkspaceOutput } from '../../sessions/model/workspace-types.js';
import { suspendSessionView } from '../suspend-view.js';
import { RemoteSessionFailure } from '../../sessions/model/session-failure.js';
import { RemoteHostKeyUntrustedError } from '../../machines/model/machine-errors.js';
import type { FileCopyMoveEvent, FileArchiveEvent } from '../../files/model/file-task-types.js';
import { RemoteFileFailure, type FileEntry, type FileInfo, type FileAttachment } from '../../files/model/file-types.js';
import { WORKSPACE_FILES_MAX_BINARY_READS } from '@nexus-terminal/shared/remote/files/values';
import {
	WORKSPACE_TERMINAL_MAX_IN_FLIGHT_BYTES,
	WORKSPACE_BINARY_MAX_PAYLOAD_BYTES,
	WORKSPACE_BINARY_PROTOCOL_VERSION,
	WORKSPACE_MAX_IN_FLIGHT_REQUESTS,
	WORKSPACE_MAX_JSON_MESSAGE_BYTES,
} from '@nexus-terminal/shared/remote/workspace/values';
import type {
	WorkspaceFileEntry,
	WorkspaceFileMetadata,
	WorkspaceFileSearchEntry,
} from '@nexus-terminal/shared/remote/files/workspace';
import type {
	WorkspaceConnectResponse,
	WorkspaceResumeResponse,
	WorkspaceProtocolRequest,
	WorkspaceProtocolResponse,
	WorkspaceProtocolResponsePayload,
} from '@nexus-terminal/shared/remote/workspace/workspace';
import type { WorkspaceSuspendResumeResponse } from '@nexus-terminal/shared/remote/suspend/workspace';
import {
	InvalidWorkspaceSuspendPayload,
	readWorkspaceSuspendMark,
	readWorkspaceSuspendResume,
	readWorkspaceSuspendAck,
	readWorkspaceSuspendSession,
	readWorkspaceSuspendRename,
	readWorkspaceSuspendHistory,
	readWorkspaceSuspendEmpty,
} from '@nexus-terminal/shared/remote/suspend/workspace-codec';
import {
	InvalidWorkspacePayload,
	readWorkspaceRequest,
	readWorkspaceConnectRequest,
	readWorkspaceResumeRequest,
	readWorkspaceResumeAck,
	readWorkspaceCloseRequest,
} from '@nexus-terminal/shared/remote/workspace/workspace-codec';
import { encodeWorkspaceBinaryFrame } from '@nexus-terminal/shared/remote/workspace/workspace-binary';
import {
	readWorkspaceTerminalInput,
	readWorkspaceTerminalResize,
	readWorkspaceTerminalFlow,
	readWorkspaceTerminalChangeDirectory,
	InvalidWorkspaceTerminalPayload,
} from '@nexus-terminal/shared/remote/terminal/workspace-codec';
import {
	InvalidWorkspaceFilesPayload,
	readWorkspaceFileCancelReadRequest,
	readWorkspaceFileChmodRequest,
	readWorkspaceFileCreateFileRequest,
	readWorkspaceFilePathRequest,
	readWorkspaceFileReadBinaryRequest,
	readWorkspaceFileRemoveRequest,
	readWorkspaceFileRenameRequest,
	readWorkspaceFileSearchRequest,
	readWorkspaceFileWriteTextRequest,
} from '@nexus-terminal/shared/remote/files/workspace-codec';
import {
	InvalidWorkspaceTransferPayload,
	readWorkspaceArchiveCompress,
	readWorkspaceArchiveDecompress,
	readWorkspaceCopyMove,
	readWorkspaceTaskCancel,
	readWorkspaceUploadAbort,
	readWorkspaceUploadPrepare,
	readWorkspaceUploadSession,
	readWorkspaceUploadStart,
} from '@nexus-terminal/shared/remote/transfers/workspace-codec';
import type {
	WorkspaceArchiveEvent,
	WorkspaceCopyMoveEvent,
	WorkspaceUploadEvent,
} from '@nexus-terminal/shared/remote/transfers/workspace';

const ROOT = '/ws/workspace';
const OUTPUT_RETRY_MS = 10;
const MAX_WS_TERMINAL_QUEUE_BYTES = 8 * 1024 * 1024;

function safeError(error: unknown): WorkspaceErrorCode {
	if (error instanceof ObservationFailure) {
		return error.code;
	}
	if (error instanceof InvalidWorkspaceDockerPayload || error instanceof InvalidObservationPayload) {
		return 'invalid_input';
	}
	if (error instanceof RemoteResourceCleanupFailure) {
		return 'operation_unknown';
	}
	if (
		error instanceof InvalidWorkspaceFilesPayload ||
		error instanceof InvalidWorkspaceTransferPayload ||
		error instanceof InvalidWorkspaceSuspendPayload ||
		error instanceof InvalidWorkspacePayload ||
		error instanceof InvalidWorkspaceTerminalPayload
	) {
		return 'invalid_input';
	}
	if (error instanceof WorkspaceFailure) {
		return error.code;
	}
	if (error instanceof RemoteHostKeyUntrustedError) {
		return 'host_key_untrusted';
	}
	if (error instanceof RemoteSessionFailure) {
		return error.code;
	}
	if (error instanceof RemoteFileFailure) {
		return error.code;
	}
	return 'remote_unavailable';
}

function metadata(info: FileInfo): WorkspaceFileMetadata {
	return {
		size: info.size,
		uid: info.uid,
		gid: info.gid,
		mode: info.mode,
		accessedAt: info.accessedAt,
		modifiedAt: info.modifiedAt,
		isFile: info.kind === 'file',
		isDirectory: info.kind === 'directory',
		isSymbolicLink: info.kind === 'symlink',
	};
}

function entry(filePath: string, item: FileEntry): WorkspaceFileEntry {
	const result: WorkspaceFileEntry = { name: item.name, path: filePath, metadata: metadata(item.info) };
	if (item.longName !== undefined) {
		result.longName = item.longName;
	}
	return result;
}

function statEntry(filePath: string, info: FileInfo): WorkspaceFileEntry {
	return {
		name: path.posix.basename(filePath),
		path: filePath,
		metadata: metadata(info),
	};
}

class WorkspaceFilesSession {
	private readonly lifetime = new AbortController();
	private readonly binaryReads = new Map<string, AbortController>();
	private inFlightRequests = 0;
	private workspaceId: string | null = null;
	private connectionId: number | null = null;
	private attachment: FileAttachment | null = null;
	private connectionName = '';
	private resumeToken = '';
	private attachmentGeneration = 0;
	private attachmentId: string | null = null;
	private connecting = false;
	private terminalOff: Array<() => void> = [];
	private terminalQueue: Uint8Array[] = [];
	private terminalQueuedBytes = 0;
	private terminalSentBytes = 0;
	private terminalConsumedBytes = 0;
	private terminalPoll: ReturnType<typeof setTimeout> | null = null;
	private identityPoll: ReturnType<typeof setInterval> | null = null;
	private statusOff: (() => void) | null = null;
	private resumeReplayOffset: number | null = null;
	private suspendedPending: string | null = null;
	private suspendedDeliveredBytes = 0;
	private suspendedViewport: { columns: number; rows: number } | null = null;

	constructor(
		private readonly channel: HttpWebSocketChannel,
		private readonly token: string | null,
		private readonly files: RemoteFileService,
		private readonly workspaces: WorkspaceService,
		private readonly observations: RemoteObservationService,
	) {
		const offAuto = workspaces.onAutoTerminated((userId, suspendedSessionId, reason) => {
			if (this.lifetime.signal.aborted) {
				return;
			}
			void workspaces.mayReceiveSuspendedEvent(this.token, userId).then((authorized) => {
				if (authorized && !this.lifetime.signal.aborted) {
					this.sendEvent('suspend.autoTerminated', { suspendedSessionId, reason });
				}
			});
		});
		channel.onMessage(async (raw) => {
			this.accept(raw);
		});
		channel.onClose(async () => {
			this.lifetime.abort();
			offAuto();
			for (const controller of this.binaryReads.values()) {
				controller.abort();
			}
			// Detach the exact attachment. The Workspace owner retains SSH/File leases
			// across the reconnect grace window; an old WS cannot close a successor.
			await this.releaseWorkspace();
		});
	}

	private accept(raw: string): void {
		if (Buffer.byteLength(raw, 'utf8') > WORKSPACE_SUSPEND_MAX_JSON_BYTES) {
			this.channel.close(1003, 'Workspace message too large');
			return;
		}
		let request: WorkspaceProtocolRequest;
		try {
			const input: unknown = JSON.parse(raw);
			request = readWorkspaceRequest(input);
			const snapshotRequest =
				request.type === 'suspend.mark' ||
				request.type === 'suspend.prepare' ||
				request.type === 'suspend.commit';
			if (!snapshotRequest && Buffer.byteLength(raw, 'utf8') > WORKSPACE_MAX_JSON_MESSAGE_BYTES) {
				throw new InvalidWorkspacePayload();
			}
		} catch {
			this.channel.close(1003, 'Invalid Workspace protocol request');
			return;
		}
		if (this.inFlightRequests >= WORKSPACE_MAX_IN_FLIGHT_REQUESTS) {
			if (request.requestId) {
				this.sendResponse(request.requestId, { ok: false, error: 'limit_exceeded' });
			} else {
				this.sendEvent('protocol.error', {
					operation: request.type,
					message: 'limit_exceeded',
				});
			}
			return;
		}
		this.inFlightRequests += 1;
		const task = this.dispatchRequest(request)
			.catch(() => undefined)
			.finally(() => {
				this.inFlightRequests -= 1;
			});
		void task;
	}

	private async dispatchRequest(request: WorkspaceProtocolRequest): Promise<void> {
		try {
			const result = await this.dispatch(request);
			if (request.type.startsWith('docker.') || request.type.startsWith('status.')) {
				const response: WorkspaceProtocolResponse = {
					type: 'response',
					requestId: request.requestId ?? '',
					payload: { ok: true, data: result },
				};
				if (Buffer.byteLength(JSON.stringify(response), 'utf8') > OBSERVATION_MAX_RESPONSE_BYTES) {
					throw new ObservationFailure('limit_exceeded');
				}
			}
			if (request.requestId) {
				this.sendResponse(request.requestId, { ok: true, data: result });
			}
		} catch (error) {
			const message = safeError(error);
			if (request.requestId) {
				this.sendResponse(request.requestId, { ok: false, error: message });
			} else {
				this.sendEvent('protocol.error', { operation: request.type, message });
			}
		}
	}

	private async dispatch(request: WorkspaceProtocolRequest): Promise<unknown> {
		// The FileService authenticates and checks each SFTP resource on its own,
		// but the shared Workspace WS must also fence requests from a superseded
		// attachment. Old sockets cannot keep mutating Files after a handoff.
		if (
			this.workspaceId &&
			this.attachmentId &&
			request.type !== 'workspace.resumeAck' &&
			request.type !== 'suspend.resumeAck' &&
			request.type !== 'workspace.resume' &&
			request.type !== 'workspace.connect' &&
			!(await this.workspaces.allowed(
				this.token,
				this.workspaceId,
				this.attachmentId,
				request.type === 'terminal.flow',
			))
		) {
			throw new WorkspaceFailure('not_found');
		}
		const payload = request.payload ?? {};
		switch (request.type) {
			case 'workspace.ping':
				return this.ping();
			case 'status.start': {
				readWorkspaceObservationEmpty(payload);
				const owner = this.observationOwner();
				if (!this.statusOff) {
					this.statusOff = this.observations.startStatus(
						owner,
						(event) => {
							if (
								this.workspaceId !== owner.workspaceId ||
								this.attachmentId !== owner.attachmentId ||
								this.lifetime.signal.aborted
							) {
								return;
							}
							if (event.kind === 'sample') {
								this.sendEvent('status.sample', observationSample(event.value));
							} else {
								this.sendEvent('status.error', { message: event.code });
							}
						},
						this.lifetime.signal,
					);
				}
				return null;
			}
			case 'status.stop':
				readWorkspaceObservationEmpty(payload);
				this.statusOff?.();
				this.statusOff = null;
				return null;
			case 'docker.status': {
				readWorkspaceObservationEmpty(payload);
				return observedDockerStatus(
					await this.observations.getDocker(this.observationOwner(), this.lifetime.signal),
				);
			}
			case 'docker.stats': {
				const input = readWorkspaceDockerStats(payload);
				const result = await this.observations.getDockerStats(
					this.observationOwner(),
					input.containerId,
					this.lifetime.signal,
				);
				return result === null ? null : observedDockerStats(result);
			}
			case 'docker.command': {
				const input = readWorkspaceDockerCommand(payload);
				await this.observations.commandDocker(
					this.observationOwner(),
					input.containerId,
					input.command,
					this.lifetime.signal,
				);
				return null;
			}
			case 'workspace.connect':
				return this.connect(payload);
			case 'workspace.resume':
				return this.resume(payload);
			case 'workspace.resumeAck':
				return this.resumeAck(payload);
			case 'workspace.close':
				return this.closeWorkspace(payload);
			case 'suspend.mark':
				return this.suspendMark(payload);
			case 'suspend.prepare':
				return this.suspendPrepare(payload);
			case 'suspend.commit':
				return this.suspendCommit(payload);
			case 'suspend.unmark':
				readWorkspaceSuspendEmpty(payload);
				return this.suspendUnmark();
			case 'suspend.list':
				readWorkspaceSuspendEmpty(payload);
				return (await this.workspaces.listSuspended(this.token)).map(suspendSessionView);
			case 'suspend.resume':
				return this.suspendResume(payload);
			case 'suspend.resumeAck':
				return this.suspendResumeAck(payload);
			case 'suspend.owner.renew':
				readWorkspaceSuspendEmpty(payload);
				return this.suspendRenew();
			case 'suspend.history.previous':
				return this.suspendHistory(payload, this.requireRequestId(request.requestId));
			case 'suspend.history.reset':
				readWorkspaceSuspendEmpty(payload);
				return this.suspendHistoryReset();
			case 'suspend.terminate': {
				const input = readWorkspaceSuspendSession(payload);
				if (!(await this.workspaces.terminateSuspended(this.token, input.suspendedSessionId))) {
					throw new WorkspaceFailure('not_found');
				}
				return null;
			}
			case 'suspend.remove': {
				const input = readWorkspaceSuspendSession(payload);
				if (!(await this.workspaces.removeDisconnectedSuspended(this.token, input.suspendedSessionId))) {
					throw new WorkspaceFailure('not_found');
				}
				return null;
			}
			case 'suspend.rename': {
				const input = readWorkspaceSuspendRename(payload);
				await this.workspaces.renameSuspended(this.token, input.suspendedSessionId, input.name);
				return null;
			}
			case 'terminal.input':
				return this.terminalInput(payload);
			case 'terminal.resize':
				return this.terminalResize(payload);
			case 'terminal.flow':
				return this.terminalFlow(payload);
			case 'terminal.currentDirectory':
				return this.terminalCurrentDirectory();
			case 'terminal.changeDirectory':
				return this.terminalChangeDirectory(payload, this.requireRequestId(request.requestId));
			case 'filesystem.list':
				return this.list(payload);
			case 'filesystem.search':
				return this.search(payload);
			case 'filesystem.stat':
				return this.stat(payload);
			case 'filesystem.readBinary':
				return this.readBinary(payload, this.requireRequestId(request.requestId));
			case 'filesystem.cancelRead':
				return this.cancelRead(payload);
			case 'upload.prepare': {
				const input = readWorkspaceUploadPrepare(payload);
				return this.files.prepareUpload(
					this.token,
					this.requireWorkspaceId(),
					input.prepareId,
					input.basePath,
					input.directories.map((directory) => directory),
					this.lifetime.signal,
				);
			}
			case 'upload.start': {
				const input = readWorkspaceUploadStart(payload);
				return this.files.startUpload(
					this.token,
					this.requireWorkspaceId(),
					{
						uploadId: input.uploadId,
						destinationPath: input.destinationPath,
						size: input.size,
						conflictPolicy: input.conflictPolicy ?? 'ask',
						prepareId: input.prepareId,
						relativePath: input.relativePath,
					},
					this.bindTransferEvents<FileUploadEvent>((event) => this.sendUploadEvent(event)),
				);
			}
			case 'upload.cancel': {
				const input = readWorkspaceUploadSession(payload);
				return this.files.cancelUpload(this.token, this.requireWorkspaceId(), input.uploadId);
			}
			case 'upload.abort': {
				const input = readWorkspaceUploadAbort(payload);
				return this.files.abortUpload(this.token, this.requireWorkspaceId(), input.uploadId);
			}
			case 'transfer.copyMove': {
				const input = readWorkspaceCopyMove(payload);
				return this.files.startCopyMove(
					this.token,
					this.requireWorkspaceId(),
					this.requireRequestId(request.requestId),
					input.mode,
					input.sources.map((source) => source),
					input.destination,
					input.sourceWorkspaceId,
					this.bindTransferEvents<FileCopyMoveEvent>((event) => this.sendCopyMoveEvent(event)),
				);
			}
			case 'transfer.cancel': {
				const input = readWorkspaceTaskCancel(payload);
				return this.files.cancelCopyMove(this.token, this.requireWorkspaceId(), input.taskId);
			}
			case 'transfer.compress': {
				const input = readWorkspaceArchiveCompress(payload);
				return this.files.startArchive(
					this.token,
					this.requireWorkspaceId(),
					this.requireRequestId(request.requestId),
					{
						kind: 'compress',
						sources: input.sources.map((source) => source),
						destination: input.destination,
						format: input.format,
						password: input.password,
					},
					this.bindTransferEvents<FileArchiveEvent>((event) => this.sendArchiveEvent(event)),
				);
			}
			case 'transfer.decompress': {
				const input = readWorkspaceArchiveDecompress(payload);
				return this.files.startArchive(
					this.token,
					this.requireWorkspaceId(),
					this.requireRequestId(request.requestId),
					{
						kind: 'decompress',
						source: input.source,
						password: input.password,
					},
					this.bindTransferEvents<FileArchiveEvent>((event) => this.sendArchiveEvent(event)),
				);
			}
			case 'transfer.cancelArchive': {
				const input = readWorkspaceTaskCancel(payload);
				return this.files.cancelArchive(this.token, this.requireWorkspaceId(), input.taskId);
			}
			case 'filesystem.writeText': {
				const input = readWorkspaceFileWriteTextRequest(payload);
				await this.files.saveText(
					this.token,
					this.requireFileResource(),
					input.path,
					input.content,
					input.encoding,
					this.lifetime.signal,
				);
				return null;
			}
			case 'filesystem.createDirectory': {
				const input = readWorkspaceFilePathRequest(payload);
				await this.files.createDirectory(
					this.token,
					this.requireFileResource(),
					input.path,
					this.lifetime.signal,
				);
				return null;
			}
			case 'filesystem.createFile': {
				const input = readWorkspaceFileCreateFileRequest(payload);
				await this.files.createFile(
					this.token,
					this.requireFileResource(),
					input.path,
					input.content ?? '',
					input.encoding,
					this.lifetime.signal,
				);
				return null;
			}
			case 'filesystem.remove': {
				const input = readWorkspaceFileRemoveRequest(payload);
				await this.files.removeMany(
					this.token,
					this.requireFileResource(),
					input.paths,
					input.forceDirectoryPaths ?? [],
					this.lifetime.signal,
				);
				return null;
			}
			case 'filesystem.rename': {
				const input = readWorkspaceFileRenameRequest(payload);
				await this.files.moveEntry(
					this.token,
					this.requireFileResource(),
					input.from,
					input.to,
					this.lifetime.signal,
				);
				return null;
			}
			case 'filesystem.chmod': {
				const input = readWorkspaceFileChmodRequest(payload);
				await this.files.changeMode(
					this.token,
					this.requireFileResource(),
					input.path,
					input.mode,
					this.lifetime.signal,
				);
				return null;
			}
			case 'filesystem.realpath': {
				const input = readWorkspaceFilePathRequest(payload);
				const result = await this.files.resolvePath(
					this.token,
					this.requireFileResource(),
					input.path,
					this.lifetime.signal,
				);
				return {
					requestedPath: result.requestedPath,
					absolutePath: result.absolutePath,
					targetType: result.targetType,
				};
			}
			default:
				throw new WorkspaceFailure('invalid_input');
		}
	}

	private async ping(): Promise<null> {
		const attachment = this.attachment;
		const workspaceId = this.workspaceId;
		if (!workspaceId) {
			throw new RemoteFileFailure('not_found');
		}
		if (!(await this.workspaces.allowed(this.token, workspaceId, this.requireAttachmentId()))) {
			throw new WorkspaceFailure('not_found');
		}
		if (!attachment) {
			return null;
		}
		try {
			await this.files.pingWorkspace(this.token, attachment.id, workspaceId, this.lifetime.signal);
			if (this.attachment !== attachment || this.workspaceId !== workspaceId || this.lifetime.signal.aborted) {
				throw new RemoteFileFailure('not_found');
			}
			return null;
		} catch (error) {
			// SFTP can fail while the interactive PTY remains healthy.
			// A workspace heartbeat must not revoke a live terminal on file failure.
			if (this.attachment === attachment && !this.lifetime.signal.aborted) {
				this.sendEvent('filesystem.error', { message: safeError(error) });
			}
			return null;
		}
	}

	private async connect(payload: unknown): Promise<WorkspaceConnectResponse> {
		if (this.workspaceId || this.connecting || this.lifetime.signal.aborted) {
			throw new RemoteFileFailure('conflict');
		}
		const input = readWorkspaceConnectRequest(payload);
		this.connecting = true;
		let opened: Awaited<ReturnType<WorkspaceService['open']>> | null = null;
		try {
			opened = await this.workspaces.open(
				this.token,
				input.workspaceId,
				input.connectionId,
				this.lifetime.signal,
				input.viewport,
			);
			if (this.lifetime.signal.aborted) {
				throw new WorkspaceFailure('remote_unavailable');
			}
			this.workspaceId = input.workspaceId;
			this.connectionId = input.connectionId;
			this.attachment = opened.file;
			this.connectionName = opened.connectionName;
			this.resumeToken = opened.resumeToken;
			this.attachmentGeneration = opened.attachmentGeneration;
			this.attachmentId = opened.attachmentId;
			const initial = this.bindTerminal();
			return {
				workspaceId: input.workspaceId,
				connectionId: input.connectionId,
				connectionName: this.connectionName,
				binaryProtocolVersion: WORKSPACE_BINARY_PROTOCOL_VERSION,
				resumeToken: this.resumeToken,
				attachmentGeneration: this.attachmentGeneration,
				terminalOffset: initial.terminalOffset,
				replayedBytes: initial.replayedBytes,
				lastConnectedAt: opened.lastConnectedAt,
			};
		} catch (error) {
			if (opened) {
				const failures: unknown[] = [];
				try {
					await this.workspaces.closeFailedAttachment(opened.workspaceId, opened.attachmentId);
				} catch (cleanup) {
					failures.push(cleanup);
				}
				try {
					await this.releaseExactAttachment(opened.workspaceId, opened.attachmentId);
				} catch (cleanup) {
					failures.push(cleanup);
				}
				if (failures.length) {
					throw new RemoteResourceCleanupFailure([error, ...failures]);
				}
			}
			throw error;
		} finally {
			this.connecting = false;
		}
	}

	private async suspendMark(payload: unknown): Promise<{ suspendedSessionId: string }> {
		const input = readWorkspaceSuspendMark(payload);
		const owner = await this.requireTerminal();
		return this.workspaces.markSuspend(this.token, owner.id, owner.attachmentId, input.terminalSnapshot);
	}

	private async suspendPrepare(payload: unknown): Promise<null> {
		const input = readWorkspaceSuspendMark(payload);
		const owner = await this.requireTerminal();
		try {
			await this.workspaces.prepareSuspend(this.token, owner.id, owner.attachmentId, input.terminalSnapshot);
			const deadline = Date.now() + 15_000;
			while (this.terminalQueuedBytes > 0 || this.terminalSentBytes !== this.terminalConsumedBytes) {
				if (Date.now() >= deadline) {
					throw new WorkspaceFailure('remote_unavailable');
				}
				await delay(20, undefined, { signal: this.lifetime.signal });
			}
		} catch (error) {
			this.workspaces.releasePreparedSuspend(owner.id, owner.attachmentId);
			throw error;
		}
		return null;
	}

	private async suspendCommit(payload: unknown): Promise<{ suspendedSessionId: string }> {
		const input = readWorkspaceSuspendMark(payload);
		const owner = await this.requireTerminal();
		return this.workspaces.commitSuspend(this.token, owner.id, owner.attachmentId, input.terminalSnapshot);
	}

	private async suspendUnmark(): Promise<null> {
		const owner = await this.requireTerminal();
		await this.workspaces.unmarkSuspend(this.token, owner.id, owner.attachmentId);
		return null;
	}

	private async suspendResume(payload: unknown): Promise<WorkspaceSuspendResumeResponse> {
		if (this.workspaceId || this.connecting || this.lifetime.signal.aborted) {
			throw new WorkspaceFailure('conflict');
		}
		const input = readWorkspaceSuspendResume(payload);
		this.connecting = true;
		try {
			const prepared = await this.workspaces.prepareSuspendedResume(
				this.token,
				input.suspendedSessionId,
				input.workspaceId,
				input.takeover ?? false,
			);
			const view = prepared.lease;
			if (this.lifetime.signal.aborted) {
				this.workspaces.detach(view.workspaceId, view.attachmentId);
				throw new WorkspaceFailure('remote_unavailable');
			}
			this.workspaceId = view.workspaceId;
			this.attachmentId = view.attachmentId;
			this.connectionId = view.connectionId;
			this.connectionName = view.connectionName;
			this.attachment = null;
			this.resumeToken = view.resumeToken;
			this.attachmentGeneration = view.attachmentGeneration;
			this.suspendedPending = prepared.resumedFrom;
			this.suspendedDeliveredBytes = prepared.history.length;
			this.suspendedViewport = input.viewport ?? null;
			try {
				this.terminalOff.push(
					this.workspaces.onPendingSuspendRevoked(view.workspaceId, view.attachmentId, (reason) => {
						this.sendEvent('suspend.revoked', {
							suspendedSessionId: prepared.resumedFrom,
							generation: prepared.ownershipGeneration,
							reason,
						});
						this.channel.close(1008, 'Suspended ownership revoked');
					}),
				);
				// Raw baseline precedes final JSON, but NOT ownership commit.
				await this.sendReplay(prepared.history, () =>
					this.workspaces.allowed(this.token, view.workspaceId, view.attachmentId, true),
				);
				this.workspaces.startSuspendedAckDeadline(view.workspaceId, view.attachmentId);
			} catch (error) {
				return this.failAndRelease(error, view.workspaceId, view.attachmentId);
			}
			return {
				workspaceId: view.workspaceId,
				connectionId: view.connectionId,
				connectionName: view.connectionName,
				resumeToken: view.resumeToken,
				attachmentGeneration: view.attachmentGeneration,
				terminalOffset: view.terminalOffset,
				lastConnectedAt: view.lastConnectedAt,
				binaryProtocolVersion: WORKSPACE_BINARY_PROTOCOL_VERSION,
				resumedFrom: prepared.resumedFrom,
				historyAvailable: prepared.historyAvailable,
				ownershipGeneration: prepared.ownershipGeneration,
				ownershipLeaseExpiresAt: prepared.ownershipLeaseExpiresAt,
			};
		} finally {
			this.connecting = false;
		}
	}

	private async suspendResumeAck(payload: unknown): Promise<null> {
		const input = readWorkspaceSuspendAck(payload);
		const id = this.requireWorkspaceId();
		const attachmentId = this.requireAttachmentId();
		if (this.suspendedPending !== input.suspendedSessionId) {
			throw new WorkspaceFailure('not_found');
		}
		await this.workspaces.acknowledgeSuspendedResume(
			this.token,
			id,
			attachmentId,
			input.suspendedSessionId,
			input.resumeToken,
			input.attachmentGeneration,
			input.ownershipGeneration,
		);
		try {
			this.bindTerminal(false); // Baseline was already delivered before ACK.
			if (this.suspendedViewport) {
				this.workspaces.resize(id, attachmentId, this.suspendedViewport.columns, this.suspendedViewport.rows);
			}
			this.suspendedPending = null;
			this.suspendedViewport = null;
			this.workspaces.finishSuspendedResume(id, attachmentId);
		} catch (error) {
			return this.failAndRelease(error, id, attachmentId);
		}
		return null;
	}

	private async suspendRenew(): Promise<{ generation: number; leaseExpiresAt: number }> {
		const owner = await this.requireTerminal();
		return this.workspaces.renewSuspendedOwner(this.token, owner.id, owner.attachmentId);
	}

	private async suspendHistory(payload: unknown, requestId: string): Promise<{ hasMore: boolean }> {
		const input = readWorkspaceSuspendHistory(payload);
		const owner = await this.requireTerminal();
		const deadline = Date.now() + 30_000;

		const remainingMs = (): number => {
			const remaining = deadline - Date.now();
			if (remaining < 1) {
				throw new WorkspaceFailure('remote_unavailable');
			}
			return remaining;
		};

		const history = await this.workspaces.suspendHistoryPrevious(
			this.token,
			owner.id,
			owner.attachmentId,
			async (data) => {
				for (let offset = 0; offset < data.length; offset += WORKSPACE_BINARY_MAX_PAYLOAD_BYTES) {
					const piece = data.subarray(offset, offset + WORKSPACE_BINARY_MAX_PAYLOAD_BYTES);
					await this.sendBinary(
						encodeWorkspaceBinaryFrame('response', requestId, piece),
						this.lifetime.signal,
						remainingMs,
					);
				}
				await this.sendBinary(
					encodeWorkspaceBinaryFrame('response', requestId, new Uint8Array(), true),
					this.lifetime.signal,
					remainingMs,
				);
			},
			input.maxBytes,
		);
		return { hasMore: history.hasMore };
	}

	private async suspendHistoryReset(): Promise<{ available: boolean }> {
		const owner = await this.requireTerminal();
		return {
			available: await this.workspaces.resetSuspendHistory(this.token, owner.id, owner.attachmentId),
		};
	}

	private async resume(payload: unknown): Promise<WorkspaceResumeResponse> {
		if (this.workspaceId || this.connecting || this.lifetime.signal.aborted) {
			throw new WorkspaceFailure('conflict');
		}
		const input = readWorkspaceResumeRequest(payload);
		this.connecting = true;
		try {
			const prepared = await this.workspaces.resume(
				this.token,
				input.workspaceId,
				input.connectionId,
				input.resumeToken,
				input.attachmentGeneration,
				input.terminalOffset,
			);
			const view = prepared.lease;
			if (this.lifetime.signal.aborted) {
				this.workspaces.detach(view.workspaceId, view.attachmentId);
				throw new WorkspaceFailure('remote_unavailable');
			}
			this.workspaceId = view.workspaceId;
			this.connectionId = view.connectionId;
			this.attachment = view.file;
			this.connectionName = view.connectionName;
			this.resumeToken = view.resumeToken;
			this.attachmentGeneration = view.attachmentGeneration;
			this.attachmentId = view.attachmentId;
			this.resumeReplayOffset = view.terminalOffset;
			try {
				// Full delivery precedes the response, but only workspace.resumeAck
				// commits the ownership generation and resumes live input.
				await this.sendReplay(prepared.replay, () =>
					this.workspaces.allowed(this.token, view.workspaceId, view.attachmentId, true),
				);
			} catch (error) {
				return this.failAndRelease(error, view.workspaceId, view.attachmentId);
			}
			return {
				workspaceId: view.workspaceId,
				connectionId: view.connectionId,
				connectionName: view.connectionName,
				resumeToken: view.resumeToken,
				attachmentGeneration: view.attachmentGeneration,
				terminalOffset: view.terminalOffset,
				lastConnectedAt: view.lastConnectedAt,
				binaryProtocolVersion: WORKSPACE_BINARY_PROTOCOL_VERSION,
				replayedBytes: prepared.replayedBytes,
			};
		} finally {
			this.connecting = false;
		}
	}

	private async resumeAck(payload: unknown): Promise<null> {
		const input = readWorkspaceResumeAck(payload);
		const id = this.requireWorkspaceId();
		const attachmentId = this.requireAttachmentId();
		const offset = this.resumeReplayOffset;
		if (offset === null) {
			throw new WorkspaceFailure('not_found');
		}
		const live: Uint8Array[] = [];
		let replaying = true;
		let committed = false;
		try {
			const delivered = await this.workspaces.acknowledge(
				this.token,
				id,
				attachmentId,
				input.resumeToken,
				input.attachmentGeneration,
				offset,
				(item) => {
					if (replaying) {
						live.push(item.bytes);
					} else {
						this.queueTerminal(item.bytes);
					}
				},
				(reason) => this.notifyTerminalClosed(reason),
			);
			committed = true;
			this.terminalOff.push(delivered.dispose);
			this.terminalOff.push(this.bindDirectoryEvents(id, attachmentId));
			this.terminalOff.push(this.bindFileState(id, attachmentId));
			this.terminalOff.push(this.bindSuspendRevoked(id, attachmentId));
			this.startIdentityPoll(id, attachmentId);
			this.queueTerminal(delivered.replay);
			replaying = false;
			for (const bytes of live) {
				this.queueTerminal(bytes);
			}
			this.resumeReplayOffset = null;
			return null;
		} catch (error) {
			if (!committed) {
				throw error;
			}
			// The Service may already have committed the new generation.
			// A failing WS subscription/replay cannot leave a live attachment
			// without a usable owner socket; detach into the normal grace path.
			try {
				await this.releaseExactAttachment(id, attachmentId);
			} catch (cleanup) {
				throw new RemoteResourceCleanupFailure([error, cleanup]);
			}
			throw error;
		}
	}

	private requireAttachmentId(): string {
		if (!this.attachmentId) {
			throw new WorkspaceFailure('not_found');
		}
		return this.attachmentId;
	}

	private async requireTerminal(): Promise<{ id: string; attachmentId: string }> {
		const id = this.requireWorkspaceId();
		const attachmentId = this.requireAttachmentId();
		if (!(await this.workspaces.allowed(this.token, id, attachmentId))) {
			throw new WorkspaceFailure('not_found');
		}
		return { id, attachmentId };
	}

	private async terminalInput(payload: unknown): Promise<null> {
		const input = readWorkspaceTerminalInput(payload);
		const owner = await this.requireTerminal();
		this.workspaces.write(owner.id, owner.attachmentId, input.data);
		return null;
	}

	private async terminalResize(payload: unknown): Promise<null> {
		const input = readWorkspaceTerminalResize(payload);
		const owner = await this.requireTerminal();
		this.workspaces.resize(owner.id, owner.attachmentId, input.columns, input.rows);
		return null;
	}

	private async terminalFlow(payload: unknown): Promise<null> {
		const input = readWorkspaceTerminalFlow(payload);
		// The official client advertises the initial zero-consumed window before
		// workspace.connect; this is not an ownership claim or output ACK.
		if (this.workspaceId === null && input.consumedBytes === 0) {
			return null;
		}
		if (!(await this.workspaces.allowed(this.token, this.requireWorkspaceId(), this.requireAttachmentId(), true))) {
			throw new WorkspaceFailure('not_found');
		}
		if (input.consumedBytes < this.terminalConsumedBytes || input.consumedBytes > this.terminalSentBytes) {
			throw new WorkspaceFailure('invalid_input');
		}
		this.terminalConsumedBytes = input.consumedBytes;
		this.flushTerminal();
		return null;
	}

	private async terminalCurrentDirectory(): Promise<string> {
		const owner = await this.requireTerminal();
		return this.workspaces.currentDirectory(this.token, owner.id, owner.attachmentId, this.lifetime.signal);
	}

	private async terminalChangeDirectory(payload: unknown, requestId: string): Promise<{ queued: true }> {
		const input = readWorkspaceTerminalChangeDirectory(payload);
		const owner = await this.requireTerminal();
		await this.workspaces.changeDirectory(
			this.token,
			owner.id,
			owner.attachmentId,
			requestId,
			input.path,
			this.lifetime.signal,
		);
		return { queued: true };
	}

	private bindDirectoryEvents(id: string, attachmentId: string): () => void {
		return this.workspaces.onDirectoryEvent(id, attachmentId, (event) => {
			if (event.type === 'queued') {
				this.sendEvent('terminal.directoryChangeQueued', {
					requestId: event.requestId,
					path: event.path,
					waitingForPrompt: event.waitingForPrompt,
				});
			} else if (event.type === 'changed') {
				this.sendEvent('terminal.directoryChanged', { requestId: event.requestId, path: event.path });
			} else {
				this.sendEvent('terminal.directoryChangeFailed', {
					requestId: event.requestId,
					message: event.message,
				});
			}
		});
	}

	private bindFileState(id: string, attachmentId: string): () => void {
		return this.workspaces.onFileState(id, attachmentId, (state) => {
			if (this.workspaceId !== id || this.attachmentId !== attachmentId || this.lifetime.signal.aborted) {
				return;
			}
			if (state.kind === 'ready') {
				this.attachment = state.file;
				this.startInitialization();
			} else if (state.kind === 'opening') {
				this.attachment = null;
			} else if (state.kind === 'failed') {
				this.attachment = null;
				this.sendEvent('filesystem.error', { message: state.reason });
			}
		});
	}

	private bindSuspendRevoked(id: string, attachmentId: string): () => void {
		return this.workspaces.onSuspensionRevoked(id, attachmentId, (suspendedSessionId, generation, reason) => {
			this.sendEvent('suspend.revoked', {
				suspendedSessionId,
				generation,
				reason,
			});
			this.channel.close(1008, 'Suspended owner revoked');
		});
	}

	private bindTerminal(replayRetained = true): { terminalOffset: number; replayedBytes: number } {
		const id = this.requireWorkspaceId();
		const attachmentId = this.requireAttachmentId();
		const subscriptions: Array<() => void> = [];
		const duringAttach: WorkspaceOutput[] = [];
		let collecting = true;
		try {
			subscriptions.push(
				this.workspaces.onOutput(id, attachmentId, (item: WorkspaceOutput) => {
					if (collecting) {
						duringAttach.push(item);
					} else {
						this.queueTerminal(item.bytes);
					}
				}),
			);
			const retained = this.workspaces.retainedTail(id, attachmentId);
			subscriptions.push(
				this.workspaces.onClosed(id, attachmentId, (reason) => this.notifyTerminalClosed(reason)),
			);
			subscriptions.push(this.bindDirectoryEvents(id, attachmentId));
			subscriptions.push(this.bindFileState(id, attachmentId));
			subscriptions.push(this.bindSuspendRevoked(id, attachmentId));
			this.startIdentityPoll(id, attachmentId);
			this.terminalOff.push(...subscriptions);
			// Register the listener first, snapshot the retained journal second:
			// there is no byte gap between the initial replay and live output.
			if (replayRetained) {
				this.queueTerminal(retained.bytes);
			} else {
				const retainedStart = retained.endOffset - retained.bytes.length;
				if (retainedStart > this.suspendedDeliveredBytes) {
					throw new WorkspaceFailure('conflict');
				}
				this.queueTerminal(retained.bytes.subarray(Math.max(0, this.suspendedDeliveredBytes - retainedStart)));
			}
			collecting = false;
			for (const item of duringAttach) {
				const unseen = item.offset - retained.endOffset;
				if (unseen > 0) {
					this.queueTerminal(item.bytes.subarray(Math.max(0, item.bytes.length - unseen)));
				}
			}
			return { terminalOffset: retained.endOffset, replayedBytes: retained.bytes.length };
		} catch (error) {
			const failures: unknown[] = [error];
			for (const off of subscriptions.reverse()) {
				try {
					off();
				} catch (cleanup) {
					failures.push(cleanup);
				}
			}
			if (this.identityPoll) {
				clearInterval(this.identityPoll);
			}
			this.identityPoll = null;
			if (failures.length > 1) {
				throw new RemoteResourceCleanupFailure(failures);
			}
			throw error;
		}
	}

	private notifyTerminalClosed(reason: 'normal' | 'disconnected' | 'cleanup_failed' | 'closed_by_owner'): void {
		if (reason === 'normal') {
			this.sendEvent('terminal.closed', {});
			this.channel.close(1012, 'Terminal closed');
		} else if (reason !== 'closed_by_owner') {
			this.sendEvent('terminal.error', { message: 'remote_unavailable' });
			this.channel.close(1011, 'Terminal disconnected');
		}
	}

	private startIdentityPoll(id: string, attachmentId: string): void {
		if (this.identityPoll) {
			clearInterval(this.identityPoll);
		}
		this.identityPoll = setInterval(() => {
			if (this.lifetime.signal.aborted) {
				return;
			}
			void this.workspaces
				.allowed(this.token, id, attachmentId)
				.then((valid) => {
					if (!valid && this.workspaceId === id && this.attachmentId === attachmentId) {
						this.channel.close(1008, 'Workspace owner no longer authorized');
					}
				})
				.catch(() => this.channel.close(1011, 'Workspace authorization unavailable'));
		}, 15_000);
		this.identityPoll.unref();
	}

	private queueTerminal(value: Uint8Array): void {
		if (!this.attachmentId || this.lifetime.signal.aborted) {
			return;
		}
		for (let offset = 0; offset < value.length; offset += WORKSPACE_BINARY_MAX_PAYLOAD_BYTES) {
			const bytes = Uint8Array.from(
				value.subarray(offset, Math.min(value.length, offset + WORKSPACE_BINARY_MAX_PAYLOAD_BYTES)),
			);
			this.terminalQueue.push(bytes);
			this.terminalQueuedBytes += bytes.length;
			if (this.terminalQueuedBytes > MAX_WS_TERMINAL_QUEUE_BYTES) {
				this.channel.close(1013, 'Terminal consumer too slow');
				return;
			}
		}
		this.flushTerminal();
	}

	private flushTerminal(): void {
		if (!this.attachmentId || this.lifetime.signal.aborted) {
			return;
		}
		if (this.terminalPoll) {
			clearTimeout(this.terminalPoll);
			this.terminalPoll = null;
		}
		while (this.terminalQueue.length) {
			const bytes = this.terminalQueue[0];
			if (
				!bytes ||
				this.terminalSentBytes - this.terminalConsumedBytes + bytes.length >
					WORKSPACE_TERMINAL_MAX_IN_FLIGHT_BYTES
			) {
				break;
			}
			if (!this.channel.sendBinary(encodeWorkspaceBinaryFrame('terminal', undefined, bytes))) {
				break;
			}
			this.terminalQueue.shift();
			this.terminalQueuedBytes -= bytes.length;
			this.terminalSentBytes += bytes.length;
		}
		if (this.workspaceId) {
			if (
				this.terminalQueue.length > 0 ||
				this.terminalSentBytes - this.terminalConsumedBytes >= WORKSPACE_TERMINAL_MAX_IN_FLIGHT_BYTES
			) {
				this.workspaces.pause(this.workspaceId);
			} else {
				this.workspaces.resumeOutput(this.workspaceId);
			}
		}
		if (
			this.terminalQueue.length &&
			this.terminalSentBytes - this.terminalConsumedBytes < WORKSPACE_TERMINAL_MAX_IN_FLIGHT_BYTES
		) {
			this.terminalPoll = setTimeout(() => this.flushTerminal(), OUTPUT_RETRY_MS);
			this.terminalPoll.unref();
		}
	}

	private async sendReplay(bytes: Uint8Array, verify?: () => Promise<boolean>): Promise<void> {
		const deadline = Date.now() + 15_000;
		const workspaceId = this.requireWorkspaceId();
		const attachmentId = this.requireAttachmentId();

		const assertCurrent = (): void => {
			if (
				this.workspaceId !== workspaceId ||
				this.attachmentId !== attachmentId ||
				this.lifetime.signal.aborted
			) {
				throw new WorkspaceFailure('not_found');
			}
		};

		for (let offset = 0; offset < bytes.length; offset += WORKSPACE_BINARY_MAX_PAYLOAD_BYTES) {
			assertCurrent();
			if (verify && offset % (8 * WORKSPACE_BINARY_MAX_PAYLOAD_BYTES) === 0 && !(await verify())) {
				throw new WorkspaceFailure('not_found');
			}
			assertCurrent();
			const piece = bytes.subarray(offset, Math.min(offset + WORKSPACE_BINARY_MAX_PAYLOAD_BYTES, bytes.length));
			while (
				this.terminalSentBytes - this.terminalConsumedBytes + piece.length >
				WORKSPACE_TERMINAL_MAX_IN_FLIGHT_BYTES
			) {
				assertCurrent();
				const remaining = deadline - Date.now();
				if (remaining < 1) {
					throw new WorkspaceFailure('remote_unavailable');
				}
				await delay(Math.min(OUTPUT_RETRY_MS, remaining), undefined, { signal: this.lifetime.signal });
			}
			await this.sendBinary(
				encodeWorkspaceBinaryFrame('terminal', undefined, piece),
				this.lifetime.signal,
				() => {
					assertCurrent();
					const remaining = deadline - Date.now();
					if (remaining < 1) {
						throw new WorkspaceFailure('remote_unavailable');
					}
					return remaining;
				},
			);
			assertCurrent();
			this.terminalSentBytes += piece.length;
			if (Date.now() >= deadline) {
				throw new WorkspaceFailure('remote_unavailable');
			}
		}
		if (verify && !(await verify())) {
			throw new WorkspaceFailure('not_found');
		}
		assertCurrent();
	}

	private startInitialization(): void {
		const id = this.requireFileResource();
		const attachment = this.attachment;
		const task = this.files.initialize(this.token, id, this.lifetime.signal).then(
			() => {
				if (this.attachment === attachment && !this.lifetime.signal.aborted) {
					this.sendEvent('filesystem.ready', {});
				}
			},
			(error: unknown) => {
				if (this.attachment === attachment && !this.lifetime.signal.aborted) {
					this.sendEvent('filesystem.error', { message: safeError(error) });
				}
			},
		);
		void task;
	}

	private async closeWorkspace(payload: unknown): Promise<null> {
		const input = readWorkspaceCloseRequest(payload);
		if (
			input.workspaceId !== this.workspaceId ||
			input.connectionId !== this.connectionId ||
			input.resumeToken !== this.resumeToken ||
			input.attachmentGeneration !== this.attachmentGeneration
		) {
			throw new RemoteFileFailure('not_found');
		}
		const attachmentId = this.requireAttachmentId();
		try {
			await this.workspaces.closeAuthorized(
				this.token,
				input.workspaceId,
				attachmentId,
				input.connectionId,
				input.resumeToken,
				input.attachmentGeneration,
			);
		} catch (error) {
			try {
				await this.releaseExactAttachment(input.workspaceId, attachmentId);
			} catch (cleanup) {
				throw new RemoteResourceCleanupFailure([error, cleanup]);
			}
			throw error;
		}
		await this.releaseExactAttachment(input.workspaceId, attachmentId);
		return null;
	}

	private async list(payload: unknown): Promise<{ path: string; entries: WorkspaceFileEntry[] }> {
		const input = readWorkspaceFilePathRequest(payload);
		const items = await this.files.listDirectory(
			this.token,
			this.requireFileResource(),
			input.path,
			this.lifetime.signal,
		);
		return { path: input.path, entries: items.map((item) => entry(item.path, item)) };
	}

	private async search(payload: unknown): Promise<{ entries: WorkspaceFileSearchEntry[]; truncated: boolean }> {
		const input = readWorkspaceFileSearchRequest(payload);
		const result = await this.files.search(
			this.token,
			this.requireFileResource(),
			input.path,
			input.query,
			this.lifetime.signal,
		);
		return {
			entries: result.items.map((item) => {
				const result: WorkspaceFileSearchEntry = {
					name: item.name,
					path: item.path,
					relativePath: item.relativePath,
					metadata: metadata(item.info),
				};
				if (item.longName !== undefined) {
					result.longName = item.longName;
				}
				return result;
			}),
			truncated: result.truncated,
		};
	}

	private async stat(payload: unknown): Promise<WorkspaceFileEntry> {
		const input = readWorkspaceFilePathRequest(payload);
		const result = await this.files.getEntry(
			this.token,
			this.requireFileResource(),
			input.path,
			this.lifetime.signal,
		);
		return statEntry(result.path, result.info);
	}

	private async readBinary(payload: unknown, requestId: string): Promise<{ path: string }> {
		if (this.binaryReads.has(requestId) || this.binaryReads.size >= WORKSPACE_FILES_MAX_BINARY_READS) {
			throw new WorkspaceFailure('limit_exceeded');
		}
		const input = readWorkspaceFileReadBinaryRequest(payload);
		const controller = new AbortController();

		const abort = () => controller.abort();

		this.lifetime.signal.addEventListener('abort', abort, { once: true });
		if (this.lifetime.signal.aborted) {
			abort();
		}
		this.binaryReads.set(requestId, controller);
		try {
			await this.files.readBinary(
				this.token,
				this.requireFileResource(),
				input.path,
				input.maxBytes,
				async (piece, signal, remainingMs) => {
					if (piece.kind === 'end') {
						await this.sendBinary(
							encodeWorkspaceBinaryFrame('response', requestId, new Uint8Array(0), true),
							signal,
							remainingMs,
						);
						return;
					}
					for (
						let offset = 0;
						offset < piece.bytes.byteLength;
						offset += WORKSPACE_BINARY_MAX_PAYLOAD_BYTES
					) {
						const chunk = piece.bytes.subarray(
							offset,
							Math.min(offset + WORKSPACE_BINARY_MAX_PAYLOAD_BYTES, piece.bytes.byteLength),
						);
						await this.sendBinary(
							encodeWorkspaceBinaryFrame('response', requestId, chunk),
							signal,
							remainingMs,
						);
					}
				},
				controller.signal,
			);
			return { path: input.path };
		} finally {
			this.lifetime.signal.removeEventListener('abort', abort);
			if (this.binaryReads.get(requestId) === controller) {
				this.binaryReads.delete(requestId);
			}
		}
	}

	private cancelRead(payload: unknown): boolean {
		const input = readWorkspaceFileCancelReadRequest(payload);
		const controller = this.binaryReads.get(input.requestId);
		if (!controller) {
			return false;
		}
		controller.abort();
		return true;
	}

	private async sendBinary(frame: Uint8Array, signal: AbortSignal, remainingMs: () => number): Promise<void> {
		while (true) {
			signal.throwIfAborted();
			const remaining = remainingMs();
			if (this.channel.sendBinary(frame)) {
				return;
			}
			await delay(Math.min(OUTPUT_RETRY_MS, remaining), undefined, { signal });
		}
	}

	private sendResponse(requestId: string, payload: WorkspaceProtocolResponsePayload): void {
		const response: WorkspaceProtocolResponse = {
			type: 'response',
			requestId,
			payload: payload.ok ? { ok: true, data: payload.data } : { ok: false, error: payload.error },
		};
		this.sendJson(response);
	}

	private sendEvent(type: string, payload: unknown): void {
		if (
			type.startsWith('status.') &&
			Buffer.byteLength(JSON.stringify({ type, payload }), 'utf8') > OBSERVATION_MAX_RESPONSE_BYTES
		) {
			throw new ObservationFailure('limit_exceeded');
		}
		this.sendJson({ type, payload });
	}

	private sendUploadEvent(event: FileUploadEvent): void {
		let payload: WorkspaceUploadEvent;
		switch (event.type) {
			case 'ready':
			case 'cancelled':
				payload = { type: event.type, uploadId: event.uploadId };
				break;
			case 'conflict':
				payload = {
					type: 'conflict',
					uploadId: event.uploadId,
					destinationPath: event.destinationPath,
					filename: event.filename,
				};
				break;
			case 'skipped':
				payload = { type: 'skipped', uploadId: event.uploadId, destinationPath: event.destinationPath };
				break;
			case 'progress':
				payload = {
					type: 'progress',
					uploadId: event.uploadId,
					chunkIndex: event.chunkIndex,
					bytesWritten: event.bytesWritten,
					totalSize: event.totalSize,
					progress: event.progress,
				};
				break;
			case 'completed':
				payload = {
					type: 'completed',
					uploadId: event.uploadId,
					destinationPath: event.destinationPath,
					item: statEntry(event.item.path, event.item.info),
				};
				break;
			case 'failed':
				payload = { type: 'failed', uploadId: event.uploadId, message: event.message };
				break;
		}
		this.sendEvent('transfer.upload', payload);
	}

	private sendCopyMoveEvent(event: FileCopyMoveEvent): void {
		let payload: WorkspaceCopyMoveEvent;
		switch (event.type) {
			case 'progress':
				payload = {
					type: 'progress',
					requestId: event.requestId,
					transferredBytes: event.transferredBytes,
					totalBytes: event.totalBytes,
					completedFiles: event.completedFiles,
					totalFiles: event.totalFiles,
					totalKnown: event.totalKnown,
					currentFile: event.currentFile,
				};
				break;
			case 'completed':
				payload = {
					type: 'completed',
					requestId: event.requestId,
					mode: event.mode,
					sourcePaths: event.sourcePaths.map((source) => source),
					destinationPath: event.destinationPath,
					items: event.items.map((item) => statEntry(item.path, item.info)),
					crossSession: event.crossSession,
					sourceOwnerId: event.sourceOwnerId,
				};
				break;
			case 'failed':
				payload = { type: 'failed', requestId: event.requestId, mode: event.mode, message: event.message };
				break;
			case 'cancelling':
			case 'cancelled':
				payload = { type: event.type, requestId: event.requestId };
				break;
		}
		this.sendEvent('transfer.copyMove', payload);
	}

	private bindTransferEvents<T>(emit: (event: T) => void): (event: T) => void {
		const attachment = this.attachment;
		return (event) => {
			if (attachment !== null && this.attachment === attachment && !this.lifetime.signal.aborted) {
				emit(event);
			}
		};
	}

	private sendArchiveEvent(event: FileArchiveEvent): void {
		let payload: WorkspaceArchiveEvent;
		switch (event.type) {
			case 'progress':
				payload = {
					type: 'progress',
					operation: event.operation,
					requestId: event.requestId,
					fileCount: event.fileCount,
					totalFiles: event.totalFiles,
					percent: event.percent,
					currentFile: event.currentFile,
				};
				break;
			case 'completed':
				payload = {
					type: 'completed',
					operation: event.operation,
					requestId: event.requestId,
					path: event.path,
					warning: event.warning === undefined ? undefined : 'verified_warning',
				};
				break;
			case 'failed':
				payload = {
					type: 'failed',
					operation: event.operation,
					requestId: event.requestId,
					message: event.message,
					code: event.code,
					commandNotFound: WORKSPACE_ARCHIVE_TOOLS.find((tool) => tool === event.commandNotFound),
				};
				break;
			case 'cancelled':
				payload = { type: 'cancelled', operation: event.operation, requestId: event.requestId };
				break;
		}
		this.sendEvent('transfer.archive', payload);
	}

	private requireWorkspaceId(): string {
		if (!this.workspaceId) {
			throw new RemoteFileFailure('not_found');
		}
		return this.workspaceId;
	}

	private sendJson(value: unknown): void {
		const encoded = JSON.stringify(value);
		if (!this.channel.send(encoded)) {
			this.channel.close(1011, 'Workspace output unavailable');
		}
	}

	private requireRequestId(value: string | undefined): string {
		if (!value) {
			throw new RemoteFileFailure('invalid_input');
		}
		return value;
	}

	private requireFileResource(): string {
		if (!this.attachment || !this.workspaceId) {
			throw new RemoteFileFailure('not_found');
		}
		return this.attachment.id;
	}

	/** Late error/finally handlers may only release the particular attachment
	 * they created. Another request on this same WS may already own a new one. */
	private async failAndRelease(error: unknown, id: string, attachmentId: string): Promise<never> {
		try {
			await this.releaseExactAttachment(id, attachmentId);
		} catch (cleanup) {
			throw new RemoteResourceCleanupFailure([error, cleanup]);
		}
		throw error;
	}

	private releaseExactAttachment(id: string, attachmentId: string): Promise<void> {
		if (this.workspaceId === id && this.attachmentId === attachmentId) {
			return this.releaseWorkspace();
		}
		try {
			this.workspaces.detach(id, attachmentId);
			return Promise.resolve();
		} catch (error) {
			return Promise.reject(error);
		}
	}

	private observationOwner(): WorkspaceObservationOwner {
		return { workspaceId: this.requireWorkspaceId(), attachmentId: this.requireAttachmentId(), token: this.token };
	}

	private releaseWorkspace(): Promise<void> {
		const failures: unknown[] = [];
		const statusOff = this.statusOff;
		this.statusOff = null;
		try {
			statusOff?.();
		} catch (error) {
			failures.push(error);
		}
		for (const controller of this.binaryReads.values()) {
			controller.abort();
		}
		const workspaceId = this.workspaceId;
		const attachmentId = this.attachmentId;
		for (const off of this.terminalOff.splice(0)) {
			try {
				off();
			} catch (error) {
				failures.push(error);
			}
		}
		if (this.terminalPoll) {
			clearTimeout(this.terminalPoll);
		}
		this.terminalPoll = null;
		if (this.identityPoll) {
			clearInterval(this.identityPoll);
		}
		this.identityPoll = null;
		this.terminalQueue.length = 0;
		this.terminalQueuedBytes = 0;
		// Flow credit belongs to one attachment, not to the long-lived WS.
		// Reusing this socket for another Workspace starts at consumedBytes=0.
		this.terminalSentBytes = 0;
		this.terminalConsumedBytes = 0;
		this.resumeReplayOffset = null;
		this.suspendedPending = null;
		this.suspendedDeliveredBytes = 0;
		this.suspendedViewport = null;
		this.attachmentId = null;
		this.attachment = null;
		this.workspaceId = null;
		this.connectionId = null;
		this.resumeToken = '';
		this.attachmentGeneration = 0;
		if (workspaceId && attachmentId) {
			try {
				this.workspaces.detach(workspaceId, attachmentId);
				this.workspaces.resumeOutput(workspaceId);
			} catch (error) {
				failures.push(error);
			}
		}
		return failures.length ? Promise.reject(new RemoteResourceCleanupFailure(failures)) : Promise.resolve();
	}
}

export function createWorkspaceFilesRoute(
	access: AccessPublicApi,
	files: RemoteFileService,
	workspaces: WorkspaceService,
	observations: RemoteObservationService,
): HttpWebSocketRoute {
	return {
		path: ROOT,
		maxTextMessageBytes: WORKSPACE_SUSPEND_MAX_JSON_BYTES,

		async authorize(request: IncomingMessage): Promise<boolean> {
			const token = readRequestCookie(request, ACCESS_SESSION_COOKIE_NAME);
			const identity = token ? await access.authenticate(token) : null;
			return identity?.userId === 1;
		},

		connected(channel, request) {
			new WorkspaceFilesSession(
				channel,
				readRequestCookie(request, ACCESS_SESSION_COOKIE_NAME),
				files,
				workspaces,
				observations,
			);
		},
	};
}
