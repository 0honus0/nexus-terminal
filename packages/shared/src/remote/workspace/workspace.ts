/** Common JSON envelope for Files, Terminal, Transfers and Suspend. */
export interface WorkspaceProtocolRequest<TPayload = unknown> {
	type: string;
	requestId?: string;
	payload?: TPayload;
}

export interface WorkspaceProtocolResponsePayload<T = unknown> {
	ok: boolean;
	data?: T;
	error?: string;
}

export interface WorkspaceProtocolResponse<T = unknown> {
	type: 'response';
	requestId: string;
	payload: WorkspaceProtocolResponsePayload<T>;
}

export interface WorkspaceProtocolEvent<T = unknown, TType extends string = string> {
	type: TType;
	payload?: T;
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

export interface WorkspaceConnectResponse {
	workspaceId: string;
	connectionId: number;
	connectionName: string;
	binaryProtocolVersion: 1;
	resumeToken: string;
	attachmentGeneration: number;
	terminalOffset: number;
	lastConnectedAt?: number;
}

export interface WorkspaceResumeRequest {
	workspaceId: string;
	connectionId: number;
	resumeToken: string;
	attachmentGeneration: number;
	terminalOffset: number;
	viewport?: WorkspaceTerminalViewport;
}

export interface WorkspaceResumeResponse extends WorkspaceConnectResponse {
	replayedBytes: number;
}

export type WorkspaceCloseRequest = Pick<
	WorkspaceResumeRequest,
	'workspaceId' | 'connectionId' | 'resumeToken' | 'attachmentGeneration'
>;

/** Explicit resume transaction confirmation; sending bytes is not a client ACK. */
export interface WorkspaceResumeAck {
	resumeToken: string;
	attachmentGeneration: number;
}
