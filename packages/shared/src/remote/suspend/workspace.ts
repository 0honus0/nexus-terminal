import type { SuspendedSessionView } from './http.js';
import type { SuspendedRevocationReason, SuspendedTerminationReason } from './values.js';
import type { WorkspaceAttachment, WorkspaceTerminalViewport } from '../workspace/workspace.js';

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

export interface WorkspaceSuspendResumeResponse extends WorkspaceAttachment {
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

export interface WorkspaceSuspendAutoTerminatedEvent {
	suspendedSessionId: string;
	reason: SuspendedTerminationReason;
}

export interface WorkspaceSuspendRevokedEvent {
	suspendedSessionId: string;
	generation: number;
	reason: SuspendedRevocationReason;
}

export interface WorkspaceSuspendUnmarkedEvent {
	suspendedSessionId: string;
	generation: number;
}

export interface WorkspaceSuspendRequests {
	'suspend.mark': WorkspaceSuspendMarkRequest;
	'suspend.prepare': WorkspaceSuspendMarkRequest;
	'suspend.commit': WorkspaceSuspendMarkRequest;
	'suspend.unmark': Record<string, never>;
	'suspend.list': Record<string, never>;
	'suspend.resume': WorkspaceSuspendResumeRequest;
	'suspend.resumeAck': WorkspaceSuspendResumeAck;
	'suspend.owner.renew': Record<string, never>;
	'suspend.history.previous': WorkspaceSuspendHistoryPreviousRequest;
	'suspend.history.reset': Record<string, never>;
	'suspend.terminate': WorkspaceSuspendSessionRequest;
	'suspend.remove': WorkspaceSuspendSessionRequest;
	'suspend.rename': WorkspaceSuspendRenameRequest;
}

export interface WorkspaceSuspendResponses {
	'suspend.mark': WorkspaceSuspendMarkResponse;
	'suspend.prepare': null;
	'suspend.commit': WorkspaceSuspendMarkResponse;
	'suspend.unmark': null;
	'suspend.list': SuspendedSessionView[];
	'suspend.resume': WorkspaceSuspendResumeResponse;
	'suspend.resumeAck': null;
	'suspend.owner.renew': WorkspaceSuspendOwnerRenewResponse;
	'suspend.history.previous': WorkspaceSuspendHistoryPreviousResponse;
	'suspend.history.reset': WorkspaceSuspendHistoryResetResponse;
	'suspend.terminate': null;
	'suspend.remove': null;
	'suspend.rename': null;
}

export interface WorkspaceSuspendViewportEvent {
	columns: number;
	rows: number;
	stage: 'baseline' | 'live';
}

export interface WorkspaceSuspendEvents {
	'suspend.viewport': WorkspaceSuspendViewportEvent;
	'suspend.autoTerminated': WorkspaceSuspendAutoTerminatedEvent;
	'suspend.revoked': WorkspaceSuspendRevokedEvent;
	'suspend.unmarked': WorkspaceSuspendUnmarkedEvent;
}
