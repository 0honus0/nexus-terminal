/** New backend-only SSH PTY session. Not a legacy Workspace session/ticket. */
export interface RemoteShellView {
	id: string;
	targetId: number;
	configurationFingerprint: string;
	startedAt: number;
	status: 'open';
}

/** The ephemeral Remote PTY identifier has one wire representation on both sides. */
export function isRemoteSessionId(value: unknown): value is string {
	return typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value);
}
