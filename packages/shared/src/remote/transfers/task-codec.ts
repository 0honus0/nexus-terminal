import { readWorkspaceFileEntry } from '../files/workspace-codec.js';
import { REMOTE_FILE_ERROR_CODES } from '../files/values.js';
import { isWellFormedFileText } from '../files/text-codec.js';
import type { WorkspaceArchiveEvent, WorkspaceCopyMoveEvent } from './workspace.js';
import {
	WORKSPACE_ARCHIVE_ERROR_CODES,
	WORKSPACE_ARCHIVE_TOOLS,
	WORKSPACE_TRANSFER_MAX_PATH_BYTES,
	WORKSPACE_TRANSFER_MAX_TASK_ID_BYTES,
} from './values.js';
import { InvalidWorkspaceTransferPayload } from './workspace-codec.js';

function isRecord(input: unknown): input is Record<string, unknown> {
	return input !== null && typeof input === 'object' && !Array.isArray(input);
}

function record(input: unknown): Record<string, unknown> {
	if (!isRecord(input)) {
		throw new InvalidWorkspaceTransferPayload();
	}
	return input;
}

function text(input: unknown, maximum: number): string {
	if (
		typeof input !== 'string' ||
		!input ||
		input.includes('\0') ||
		!isWellFormedFileText(input) ||
		new TextEncoder().encode(input).byteLength > maximum
	) {
		throw new InvalidWorkspaceTransferPayload();
	}
	return input;
}

function path(input: unknown): string {
	const value = text(input, WORKSPACE_TRANSFER_MAX_PATH_BYTES);
	if (!value.startsWith('/')) {
		throw new InvalidWorkspaceTransferPayload();
	}
	return value;
}

function count(input: unknown): number {
	if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0) {
		throw new InvalidWorkspaceTransferPayload();
	}
	return input;
}

function percentage(input: unknown): number {
	if (typeof input !== 'number' || !Number.isFinite(input) || input < 0 || input > 100) {
		throw new InvalidWorkspaceTransferPayload();
	}
	return input;
}

export function readWorkspaceCopyMoveEvent(input: unknown): WorkspaceCopyMoveEvent {
	const value = record(input);
	const requestId = text(value.requestId, WORKSPACE_TRANSFER_MAX_TASK_ID_BYTES);
	switch (value.type) {
		case 'cancelling':
		case 'cancelled':
			return { type: value.type, requestId };
		case 'progress': {
			const transferredBytes = count(value.transferredBytes);
			const totalBytes = count(value.totalBytes);
			const completedFiles = count(value.completedFiles);
			const totalFiles = count(value.totalFiles);
			if (
				typeof value.totalKnown !== 'boolean' ||
				(value.totalKnown && (transferredBytes > totalBytes || completedFiles > totalFiles))
			) {
				throw new InvalidWorkspaceTransferPayload();
			}
			const result: WorkspaceCopyMoveEvent = {
				type: 'progress',
				requestId,
				transferredBytes,
				totalBytes,
				completedFiles,
				totalFiles,
				totalKnown: value.totalKnown,
			};
			if (value.currentFile !== undefined) {
				result.currentFile = path(value.currentFile);
			}
			return result;
		}
		case 'failed': {
			const message = REMOTE_FILE_ERROR_CODES.find((code) => code === value.message);
			if (!message || (value.mode !== 'copy' && value.mode !== 'move')) {
				throw new InvalidWorkspaceTransferPayload();
			}
			return { type: 'failed', requestId, mode: value.mode, message };
		}
		case 'completed': {
			if (
				(value.mode !== 'copy' && value.mode !== 'move') ||
				!Array.isArray(value.sourcePaths) ||
				!value.sourcePaths.length ||
				!Array.isArray(value.items) ||
				value.items.length !== value.sourcePaths.length ||
				typeof value.crossSession !== 'boolean'
			) {
				throw new InvalidWorkspaceTransferPayload();
			}
			const sourcePaths = value.sourcePaths.map(path);
			const items = value.items.map(readWorkspaceFileEntry);
			if (
				new Set(sourcePaths).size !== sourcePaths.length ||
				new Set(items.map((item) => item.path)).size !== items.length
			) {
				throw new InvalidWorkspaceTransferPayload();
			}
			const result: WorkspaceCopyMoveEvent = {
				type: 'completed',
				requestId,
				mode: value.mode,
				sourcePaths,
				destinationPath: path(value.destinationPath),
				items,
				crossSession: value.crossSession,
			};
			if (value.crossSession) {
				const owner = text(value.sourceOwnerId, 128);
				if (!/^[A-Za-z0-9_-]{8,128}$/u.test(owner)) {
					throw new InvalidWorkspaceTransferPayload();
				}
				result.sourceOwnerId = owner;
			} else if (value.sourceOwnerId !== undefined) {
				throw new InvalidWorkspaceTransferPayload();
			}
			return result;
		}
		default:
			throw new InvalidWorkspaceTransferPayload();
	}
}

export function readWorkspaceArchiveEvent(input: unknown): WorkspaceArchiveEvent {
	const value = record(input);
	const requestId = text(value.requestId, WORKSPACE_TRANSFER_MAX_TASK_ID_BYTES);
	if (value.operation !== 'compress' && value.operation !== 'decompress') {
		throw new InvalidWorkspaceTransferPayload();
	}
	const operation = value.operation;
	switch (value.type) {
		case 'cancelled':
			return { type: 'cancelled', operation, requestId };
		case 'progress': {
			const fileCount = count(value.fileCount);
			const result: WorkspaceArchiveEvent = { type: 'progress', operation, requestId, fileCount };
			if (value.totalFiles !== undefined) {
				result.totalFiles = count(value.totalFiles);
				if (fileCount > result.totalFiles) {
					throw new InvalidWorkspaceTransferPayload();
				}
			}
			if (value.percent !== undefined) {
				result.percent = percentage(value.percent);
			}
			if (value.currentFile !== undefined) {
				result.currentFile = path(value.currentFile);
			}
			return result;
		}
		case 'completed': {
			const result: WorkspaceArchiveEvent = { type: 'completed', operation, requestId, path: path(value.path) };
			if (value.warning !== undefined) {
				if (value.warning !== 'verified_warning' || operation !== 'compress') {
					throw new InvalidWorkspaceTransferPayload();
				}
				result.warning = 'verified_warning';
			}
			return result;
		}
		case 'failed': {
			const code = WORKSPACE_ARCHIVE_ERROR_CODES.find((code) => code === value.message);
			const message = code ?? REMOTE_FILE_ERROR_CODES.find((code) => code === value.message);
			if (!message || value.code !== code) {
				throw new InvalidWorkspaceTransferPayload();
			}
			const result: WorkspaceArchiveEvent = { type: 'failed', operation, requestId, message };
			if (code !== undefined) {
				result.code = code;
			}
			if (value.commandNotFound !== undefined) {
				const tool = WORKSPACE_ARCHIVE_TOOLS.find((tool) => tool === value.commandNotFound);
				if (code !== 'COMMAND_NOT_FOUND' || tool === undefined) {
					throw new InvalidWorkspaceTransferPayload();
				}
				result.commandNotFound = tool;
			}
			return result;
		}
		default:
			throw new InvalidWorkspaceTransferPayload();
	}
}
