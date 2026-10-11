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

export interface WorkspaceTransferHttpError {
	message: string;
}
