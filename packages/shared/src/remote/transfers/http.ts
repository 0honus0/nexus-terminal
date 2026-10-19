import type { WorkspaceTransferHttpErrorCode, WorkspaceTransferTransportErrorCode } from './values.js';

/** Existing /sftp/download-ticket POST body; sessionId is an optional selector. */
export interface WorkspaceDownloadTicketRequest {
	connectionId: number;
	sessionId?: string;
	remotePath: string;
}

export interface WorkspaceDownloadTicketResponse {
	url: string;
	expiresInSeconds: number;
}

/** Route failures use message; transport admission/input failures use code. */
export type WorkspaceTransferHttpError =
	{ message: WorkspaceTransferHttpErrorCode } | { code: WorkspaceTransferTransportErrorCode };
