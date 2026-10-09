/** New backend-only SSH PTY session. Not a legacy Workspace session/ticket. */
export interface RemoteShellView {
	id: string;
	targetId: number;
	configurationFingerprint: string;
	startedAt: number;
	status: 'open';
}

export interface RemoteOpenShell {
	targetId: number;
	columns: number;
	rows: number;
	term?: string;
}
