import { isWellFormedFileText } from '../files/text-codec.js';
import { REMOTE_FILE_ERROR_CODES } from '../files/values.js';
import type {
	WorkspaceDownloadTicketRequest,
	WorkspaceDownloadTicketResponse,
	WorkspaceTransferHttpError,
} from './http.js';
import {
	WORKSPACE_DOWNLOAD_TICKET_TTL_SECONDS,
	WORKSPACE_TRANSFER_MAX_PATH_BYTES,
	WORKSPACE_TRANSFER_MAX_TASK_ID_BYTES,
} from './values.js';

export class InvalidDownloadTicketRequest extends Error {
	constructor() {
		super('invalid_download_ticket_request');
	}
}

function isRecord(input: unknown): input is Record<string, unknown> {
	return input !== null && typeof input === 'object' && !Array.isArray(input);
}

export function readDownloadTicketRequest(input: unknown): WorkspaceDownloadTicketRequest {
	if (!isRecord(input)) {
		throw new InvalidDownloadTicketRequest();
	}
	const data = input;
	const id = data.connectionId;
	if (
		typeof id !== 'number' ||
		!Number.isSafeInteger(id) ||
		id < 1 ||
		typeof data.remotePath !== 'string' ||
		!data.remotePath.startsWith('/') ||
		!isWellFormedFileText(data.remotePath) ||
		data.remotePath.includes('\0') ||
		new TextEncoder().encode(data.remotePath).byteLength > WORKSPACE_TRANSFER_MAX_PATH_BYTES ||
		(data.sessionId !== undefined &&
			(typeof data.sessionId !== 'string' ||
				data.sessionId.includes('\0') ||
				!isWellFormedFileText(data.sessionId) ||
				new TextEncoder().encode(data.sessionId).byteLength > WORKSPACE_TRANSFER_MAX_TASK_ID_BYTES))
	) {
		throw new InvalidDownloadTicketRequest();
	}
	const result: WorkspaceDownloadTicketRequest = {
		connectionId: id,
		remotePath: data.remotePath,
	};
	if (typeof data.sessionId === 'string') {
		result.sessionId = data.sessionId;
	}
	return result;
}

export class InvalidDownloadPayload extends Error {
	constructor() {
		super('invalid_download_payload');
	}
}

/** Tickets are delivered only as this relative route, never an arbitrary navigation URL. */
export function readDownloadTicketResponse(input: unknown): WorkspaceDownloadTicketResponse {
	if (
		!isRecord(input) ||
		typeof input.url !== 'string' ||
		!/^\/api\/v1\/sftp\/download\?ticket=[A-Za-z0-9_.-]{1,256}$/u.test(input.url) ||
		input.expiresInSeconds !== WORKSPACE_DOWNLOAD_TICKET_TTL_SECONDS
	) {
		throw new InvalidDownloadPayload();
	}
	return { url: input.url, expiresInSeconds: input.expiresInSeconds };
}

export function readWorkspaceTransferHttpError(input: unknown): WorkspaceTransferHttpError {
	if (!isRecord(input)) {
		throw new InvalidDownloadPayload();
	}
	const message = input.message;
	if ('code' in input) {
		if ('message' in input) {
			throw new InvalidDownloadPayload();
		}
		if (input.code === 'invalid_body') {
			return { code: 'invalid_body' };
		}
		for (const code of REMOTE_FILE_ERROR_CODES) {
			if (input.code === code) {
				return { code };
			}
		}
		throw new InvalidDownloadPayload();
	}
	for (const code of REMOTE_FILE_ERROR_CODES) {
		if (message === code) {
			return { message: code };
		}
	}
	if (
		message === 'inline_preview_too_large' ||
		message === 'download_ticket_expired' ||
		message === 'download_ticket_locked'
	) {
		return { message };
	}
	throw new InvalidDownloadPayload();
}
