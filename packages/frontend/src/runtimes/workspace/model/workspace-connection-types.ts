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

export interface WorkspaceConnection extends WorkspaceConnectionState {
	replayedBytes: number;
}
