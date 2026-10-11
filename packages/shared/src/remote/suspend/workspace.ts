import type { WorkspaceConnectResponse, WorkspaceTerminalViewport } from '../workspace/workspace.js';

export interface WorkspaceSuspendMarkRequest {
	terminalSnapshot?: string;
}

export interface WorkspaceSuspendMarkResponse {
	suspendedSessionId: string;
}

export interface WorkspaceSuspendResumeRequest {
	suspendedSessionId: string;
	workspaceId: string;
	viewport?: WorkspaceTerminalViewport;
	takeover?: boolean;
}

export interface WorkspaceSuspendResumeResponse extends WorkspaceConnectResponse {
	resumedFrom: string;
	historyAvailable: boolean;
	ownershipGeneration: number;
	ownershipLeaseExpiresAt: number;
}

/** Terminal baseline is sent first; only this explicit ACK transfers the PTY. */
export interface WorkspaceSuspendResumeAck {
	suspendedSessionId: string;
	resumeToken: string;
	attachmentGeneration: number;
	ownershipGeneration: number;
}

export interface WorkspaceSuspendOwnerRenewResponse {
	generation: number;
	leaseExpiresAt: number;
}

export interface WorkspaceSuspendHistoryPreviousRequest {
	maxBytes?: number;
}

export interface WorkspaceSuspendHistoryPreviousResponse {
	hasMore: boolean;
}

export interface WorkspaceSuspendHistoryResetResponse {
	available: boolean;
}

export interface WorkspaceSuspendSessionRequest {
	suspendedSessionId: string;
}

export interface WorkspaceSuspendRenameRequest extends WorkspaceSuspendSessionRequest {
	name: string;
}
