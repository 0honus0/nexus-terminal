import { isWellFormedFileText } from '../files/text-codec.js';
import type { WorkspaceDownloadTicketRequest } from './http.js';
import { WORKSPACE_TRANSFER_MAX_PATH_BYTES, WORKSPACE_TRANSFER_MAX_TASK_ID_BYTES } from './values.js';

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
		!data.remotePath ||
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
