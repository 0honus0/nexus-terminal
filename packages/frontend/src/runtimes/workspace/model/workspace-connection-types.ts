export interface WorkspaceConnectionState {
	workspaceId: string;
	connectionId: number;
	connectionName: string;
	resumeToken: string;
	attachmentGeneration: number;
	terminalOffset: number;
	lastConnectedAt?: number;
}

export type WorkspaceCloseOutcome = 'closed' | 'detached' | 'unknown';

export type WorkspaceResetOutcome = 'reset' | 'unavailable' | 'close_unconfirmed';

export interface WorkspaceConnection extends WorkspaceConnectionState {
	replayedBytes: number;
}
