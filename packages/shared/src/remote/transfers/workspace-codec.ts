import { isWellFormedFileText } from '../files/text-codec.js';
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
} from './workspace.js';
import {
	WORKSPACE_TRANSFER_MAX_PATH_BYTES,
	WORKSPACE_TRANSFER_MAX_TASK_ID_BYTES,
	WORKSPACE_TRANSFER_MAX_SOURCES,
	WORKSPACE_UPLOAD_MAX_PREPARE_DIRECTORIES,
} from './values.js';

export class InvalidWorkspaceUploadPayload extends Error {
	constructor() {
		super('invalid_workspace_upload');
	}
}

function isRecord(input: unknown): input is Record<string, unknown> {
	return input !== null && typeof input === 'object' && !Array.isArray(input);
}

function row(input: unknown): Record<string, unknown> {
	if (!isRecord(input)) {
		throw new InvalidWorkspaceUploadPayload();
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
		throw new InvalidWorkspaceUploadPayload();
	}
	return value;
}

function uploadId(value: unknown): string {
	const id = nonEmpty(value);
	if (new TextEncoder().encode(id).byteLength > WORKSPACE_TRANSFER_MAX_TASK_ID_BYTES) {
		throw new InvalidWorkspaceUploadPayload();
	}
	return id;
}

export function readWorkspaceUploadPrepare(input: unknown): WorkspaceUploadPrepare {
	const value = row(input);
	if (
		!Array.isArray(value.directories) ||
		value.directories.length > WORKSPACE_UPLOAD_MAX_PREPARE_DIRECTORIES ||
		value.directories.some((item) => typeof item !== 'string')
	) {
		throw new InvalidWorkspaceUploadPayload();
	}
	return {
		prepareId: uploadId(value.prepareId),
		basePath: nonEmpty(value.basePath),
		directories: value.directories.map((item) => {
			if (
				typeof item !== 'string' ||
				new TextEncoder().encode(item).byteLength > WORKSPACE_TRANSFER_MAX_PATH_BYTES ||
				item.includes('\0') ||
				!isWellFormedFileText(item)
			) {
				throw new InvalidWorkspaceUploadPayload();
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
		throw new InvalidWorkspaceUploadPayload();
	}
	const result: WorkspaceUploadStart = {
		uploadId: uploadId(value.uploadId),
		destinationPath: nonEmpty(value.destinationPath),
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
		throw new InvalidWorkspaceUploadPayload();
	}
	const workspaceId = nonEmpty(input.get('workspaceId'));
	const sizeRaw = input.get('size');
	if (!sizeRaw || !/^(0|[1-9]\d*)$/u.test(sizeRaw)) {
		throw new InvalidWorkspaceUploadPayload();
	}
	const size = Number(sizeRaw);
	if (!/^[A-Za-z0-9_-]{8,128}$/u.test(workspaceId) || !Number.isSafeInteger(size)) {
		throw new InvalidWorkspaceUploadPayload();
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
		throw new InvalidWorkspaceUploadPayload();
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
		throw new InvalidWorkspaceUploadPayload();
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
		throw new InvalidWorkspaceUploadPayload();
	}
	const result: WorkspaceArchiveDecompressRequest = {
		source: nonEmpty(data.source),
	};
	if (typeof data.password === 'string') {
		result.password = data.password;
	}
	return result;
}
