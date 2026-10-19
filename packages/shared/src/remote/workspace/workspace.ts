import type { WorkspaceErrorCode } from './values.js';

/** Common JSON envelope for Files, Terminal, Transfers and Suspend. */
export interface WorkspaceProtocolRequest<TPayload = unknown> {
	type: string;
	requestId?: string;
	payload?: TPayload;
}

export type WorkspaceProtocolResponsePayload<T = unknown> =
	{ ok: true; data?: T; error?: never } | { ok: false; error: WorkspaceErrorCode; data?: never };

export interface WorkspaceProtocolResponse<T = unknown> {
	type: 'response';
	requestId: string;
	payload: WorkspaceProtocolResponsePayload<T>;
}

export interface WorkspaceProtocolEvent<T = unknown, TType extends string = string> {
	type: TType;
	payload?: T;
}

export interface WorkspaceProtocolError {
	operation: string;
	message: WorkspaceErrorCode;
}

export interface WorkspaceTerminalViewport {
	columns: number;
	rows: number;
}

export interface WorkspaceConnectRequest {
	workspaceId: string;
	connectionId: number;
	viewport?: WorkspaceTerminalViewport;
}

export interface WorkspaceAttachment {
	workspaceId: string;
	connectionId: number;
	connectionName: string;
	binaryProtocolVersion: 1;
	resumeToken: string;
	attachmentGeneration: number;
	terminalOffset: number;
	lastConnectedAt?: number;
}

/** terminalOffset is the journal endpoint; replayedBytes locates the delivered stream's start. */
export interface WorkspaceConnectResponse extends WorkspaceAttachment {
	replayedBytes: number;
}

export interface WorkspaceResumeRequest {
	workspaceId: string;
	connectionId: number;
	resumeToken: string;
	attachmentGeneration: number;
	terminalOffset: number;
	viewport?: WorkspaceTerminalViewport;
}

export type WorkspaceResumeResponse = WorkspaceConnectResponse;

export type WorkspaceCloseRequest = Pick<
	WorkspaceResumeRequest,
	'workspaceId' | 'connectionId' | 'resumeToken' | 'attachmentGeneration'
>;

/** Explicit resume transaction confirmation; sending bytes is not a client ACK. */
export interface WorkspaceResumeAck {
	resumeToken: string;
	attachmentGeneration: number;
}

export interface WorkspaceCoreRequests {
	'workspace.ping': Record<string, never>;
	'workspace.connect': WorkspaceConnectRequest;
	'workspace.resume': WorkspaceResumeRequest;
	'workspace.resumeAck': WorkspaceResumeAck;
	'workspace.close': WorkspaceCloseRequest;
}

export interface WorkspaceCoreResponses {
	'workspace.ping': null;
	'workspace.connect': WorkspaceConnectResponse;
	'workspace.resume': WorkspaceResumeResponse;
	'workspace.resumeAck': null;
	'workspace.close': null;
}

export interface WorkspaceCoreEvents {
	'protocol.error': WorkspaceProtocolError;
}
