import { isWellFormedFileText } from '../files/text-codec.js';
import { readWorkspaceFileEntry } from '../files/workspace-codec.js';
import { REMOTE_FILE_ERROR_CODES } from '../files/values.js';
import type {
	WorkspaceArchiveCompressRequest,
	WorkspaceArchiveDecompressRequest,
	WorkspaceCopyMoveRequest,
	WorkspaceTaskCancelRequest,
	WorkspaceUploadAbort,
	WorkspaceUploadPrepare,
	WorkspaceUploadSession,
	WorkspaceUploadStart,
	WorkspaceUploadStream,
	WorkspaceUploadEvent,
	WorkspaceUploadPrepared,
	WorkspaceTaskStarted,
} from './workspace.js';
import {
	WORKSPACE_TRANSFER_MAX_PATH_BYTES,
	WORKSPACE_TRANSFER_MAX_TASK_ID_BYTES,
	WORKSPACE_TRANSFER_MAX_SOURCES,
	WORKSPACE_UPLOAD_MAX_PREPARE_DIRECTORIES,
} from './values.js';

export class InvalidWorkspaceTransferPayload extends Error {
	constructor() {
		super('invalid_workspace_transfer');
	}
}

function isRecord(input: unknown): input is Record<string, unknown> {
	return input !== null && typeof input === 'object' && !Array.isArray(input);
}

function row(input: unknown): Record<string, unknown> {
	if (!isRecord(input)) {
		throw new InvalidWorkspaceTransferPayload();
	}
	return input;
}

function nonEmpty(value: unknown): string {
	if (
		typeof value !== 'string' ||
		!value ||
		!isWellFormedFileText(value) ||
		value.includes('\0') ||
		new TextEncoder().encode(value).byteLength > WORKSPACE_TRANSFER_MAX_PATH_BYTES
	) {
		throw new InvalidWorkspaceTransferPayload();
	}
	return value;
}

function uploadId(value: unknown): string {
	const id = nonEmpty(value);
	if (new TextEncoder().encode(id).byteLength > WORKSPACE_TRANSFER_MAX_TASK_ID_BYTES) {
		throw new InvalidWorkspaceTransferPayload();
	}
	return id;
}

function nonnegativeInteger(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new InvalidWorkspaceTransferPayload();
	}
	return value;
}

function absolutePath(value: unknown): string {
	const path = nonEmpty(value);
	if (!path.startsWith('/')) {
		throw new InvalidWorkspaceTransferPayload();
	}
	return path;
}

export function readWorkspaceUploadPrepared(input: unknown): WorkspaceUploadPrepared {
	const preparedDirectories = nonnegativeInteger(row(input).preparedDirectories);
	// The producer includes the root in addition to the submitted directories.
	if (preparedDirectories < 1 || preparedDirectories > WORKSPACE_UPLOAD_MAX_PREPARE_DIRECTORIES + 1) {
		throw new InvalidWorkspaceTransferPayload();
	}
	return { preparedDirectories };
}

export function readWorkspaceTaskStarted(input: unknown): WorkspaceTaskStarted {
	if (row(input).started !== true) {
		throw new InvalidWorkspaceTransferPayload();
	}
	return { started: true };
}

/** Acknowledges cancellation admission, not task completion or remote cleanup. */
export function readWorkspaceTaskStopped(input: unknown): boolean {
	if (typeof input !== 'boolean') {
		throw new InvalidWorkspaceTransferPayload();
	}
	return input;
}

export function readWorkspaceUploadEvent(input: unknown): WorkspaceUploadEvent {
	const value = row(input);
	const id = uploadId(value.uploadId);
	switch (value.type) {
		case 'ready':
		case 'cancelled':
			return { type: value.type, uploadId: id };
		case 'conflict': {
			const destinationPath = absolutePath(value.destinationPath);
			const filename = nonEmpty(value.filename);
			if (filename.includes('/') || destinationPath.split('/').at(-1) !== filename) {
				throw new InvalidWorkspaceTransferPayload();
			}
			return { type: 'conflict', uploadId: id, destinationPath, filename };
		}
		case 'skipped':
			return { type: 'skipped', uploadId: id, destinationPath: absolutePath(value.destinationPath) };
		case 'progress': {
			const chunkIndex = nonnegativeInteger(value.chunkIndex);
			const bytesWritten = nonnegativeInteger(value.bytesWritten);
			const totalSize = nonnegativeInteger(value.totalSize);
			const progress = nonnegativeInteger(value.progress);
			if (
				totalSize === 0 ||
				bytesWritten === 0 ||
				bytesWritten > totalSize ||
				progress !== Math.round((bytesWritten / totalSize) * 100)
			) {
				throw new InvalidWorkspaceTransferPayload();
			}
			return { type: 'progress', uploadId: id, chunkIndex, bytesWritten, totalSize, progress };
		}
		case 'completed': {
			const destinationPath = absolutePath(value.destinationPath);
			const item = readWorkspaceFileEntry(value.item);
			if (
				item.path !== destinationPath ||
				item.name !== destinationPath.split('/').at(-1) ||
				!item.metadata.isFile
			) {
				throw new InvalidWorkspaceTransferPayload();
			}
			return { type: 'completed', uploadId: id, destinationPath, item };
		}
		case 'failed': {
			const message = REMOTE_FILE_ERROR_CODES.find((code) => code === value.message);
			if (!message) {
				throw new InvalidWorkspaceTransferPayload();
			}
			return { type: 'failed', uploadId: id, message };
		}
		default:
			throw new InvalidWorkspaceTransferPayload();
	}
}

export function readWorkspaceUploadPrepare(input: unknown): WorkspaceUploadPrepare {
	const value = row(input);
	if (
		!Array.isArray(value.directories) ||
		value.directories.length > WORKSPACE_UPLOAD_MAX_PREPARE_DIRECTORIES ||
		value.directories.some((item) => typeof item !== 'string')
	) {
		throw new InvalidWorkspaceTransferPayload();
	}
	return {
		prepareId: uploadId(value.prepareId),
		basePath: absolutePath(value.basePath),
		directories: value.directories.map((item) => {
			if (
				typeof item !== 'string' ||
				new TextEncoder().encode(item).byteLength > WORKSPACE_TRANSFER_MAX_PATH_BYTES ||
				item.includes('\0') ||
				!isWellFormedFileText(item)
			) {
				throw new InvalidWorkspaceTransferPayload();
			}
			return item;
		}),
	};
}

export function readWorkspaceUploadStart(input: unknown): WorkspaceUploadStart {
	const value = row(input);
	if (
		typeof value.size !== 'number' ||
		!Number.isSafeInteger(value.size) ||
		value.size < 0 ||
		(value.prepareId !== undefined && typeof value.prepareId !== 'string') ||
		(value.relativePath !== undefined && typeof value.relativePath !== 'string') ||
		(value.conflictPolicy !== undefined &&
			value.conflictPolicy !== 'ask' &&
			value.conflictPolicy !== 'overwrite' &&
			value.conflictPolicy !== 'skip')
	) {
		throw new InvalidWorkspaceTransferPayload();
	}
	const result: WorkspaceUploadStart = {
		uploadId: uploadId(value.uploadId),
		destinationPath: absolutePath(value.destinationPath),
		size: value.size,
	};
	if (value.prepareId !== undefined) {
		result.prepareId = uploadId(value.prepareId);
	}
	if (value.relativePath !== undefined) {
		result.relativePath = nonEmpty(value.relativePath);
	}
	if (value.conflictPolicy !== undefined) {
		result.conflictPolicy = value.conflictPolicy;
	}
	return result;
}

export function readWorkspaceUploadSession(input: unknown): WorkspaceUploadSession {
	return { uploadId: uploadId(row(input).uploadId) };
}

export function readWorkspaceUploadAbort(input: unknown): WorkspaceUploadAbort {
	const value = row(input);
	return { uploadId: uploadId(value.uploadId), message: nonEmpty(value.message) };
}

export function readWorkspaceUploadStream(input: URLSearchParams): WorkspaceUploadStream {
	if (
		input.getAll('workspaceId').length !== 1 ||
		input.getAll('uploadId').length !== 1 ||
		input.getAll('size').length !== 1 ||
		[...input.keys()].some((key) => !['workspaceId', 'uploadId', 'size'].includes(key))
	) {
		throw new InvalidWorkspaceTransferPayload();
	}
	const workspaceId = nonEmpty(input.get('workspaceId'));
	const sizeRaw = input.get('size');
	if (!sizeRaw || !/^(0|[1-9]\d*)$/u.test(sizeRaw)) {
		throw new InvalidWorkspaceTransferPayload();
	}
	const size = Number(sizeRaw);
	if (!/^[A-Za-z0-9_-]{8,128}$/u.test(workspaceId) || !Number.isSafeInteger(size)) {
		throw new InvalidWorkspaceTransferPayload();
	}
	return { workspaceId, uploadId: uploadId(input.get('uploadId')), size };
}

export function readWorkspaceCopyMove(input: unknown): WorkspaceCopyMoveRequest {
	const data = row(input);
	if (
		(data.mode !== 'copy' && data.mode !== 'move') ||
		!Array.isArray(data.sources) ||
		data.sources.length < 1 ||
		data.sources.length > WORKSPACE_TRANSFER_MAX_SOURCES ||
		data.sources.some(
			(p) =>
				typeof p !== 'string' ||
				!p ||
				new TextEncoder().encode(p).byteLength > WORKSPACE_TRANSFER_MAX_PATH_BYTES,
		) ||
		(data.sourceWorkspaceId !== undefined &&
			(typeof data.sourceWorkspaceId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/u.test(data.sourceWorkspaceId)))
	) {
		throw new InvalidWorkspaceTransferPayload();
	}
	const result: WorkspaceCopyMoveRequest = {
		mode: data.mode,
		sources: data.sources.map(nonEmpty),
		destination: nonEmpty(data.destination),
	};
	if (typeof data.sourceWorkspaceId === 'string') {
		result.sourceWorkspaceId = data.sourceWorkspaceId;
	}
	return result;
}

export function readWorkspaceTaskCancel(input: unknown): WorkspaceTaskCancelRequest {
	const value = row(input);
	return { taskId: uploadId(value.taskId) };
}

export function readWorkspaceArchiveCompress(input: unknown): WorkspaceArchiveCompressRequest {
	const data = row(input);
	if (
		!Array.isArray(data.sources) ||
		data.sources.length < 1 ||
		data.sources.length > WORKSPACE_TRANSFER_MAX_SOURCES ||
		data.sources.some(
			(value) =>
				typeof value !== 'string' ||
				!value ||
				value.includes('\0') ||
				new TextEncoder().encode(value).byteLength > WORKSPACE_TRANSFER_MAX_PATH_BYTES,
		) ||
		(data.format !== 'zip' && data.format !== 'tar.gz' && data.format !== 'tar.bz2') ||
		(data.password !== undefined && (typeof data.password !== 'string' || !isWellFormedFileText(data.password)))
	) {
		throw new InvalidWorkspaceTransferPayload();
	}
	const result: WorkspaceArchiveCompressRequest = {
		sources: data.sources.map(nonEmpty),
		destination: nonEmpty(data.destination),
		format: data.format,
	};
	if (typeof data.password === 'string') {
		result.password = data.password;
	}
	return result;
}

export function readWorkspaceArchiveDecompress(input: unknown): WorkspaceArchiveDecompressRequest {
	const data = row(input);
	if (data.password !== undefined && (typeof data.password !== 'string' || !isWellFormedFileText(data.password))) {
		throw new InvalidWorkspaceTransferPayload();
	}
	const result: WorkspaceArchiveDecompressRequest = {
		source: nonEmpty(data.source),
	};
	if (typeof data.password === 'string') {
		result.password = data.password;
	}
	return result;
}
