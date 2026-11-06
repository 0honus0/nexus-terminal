import type { AgentResourceSessionState } from '@nexus-terminal/shared/agent/runs/values';

export interface NativeResourceSession {
	id: string;
	runId: string;
	state: AgentResourceSessionState;
	openedAt: number;
	sshConnections: number;
	sftpChannels: number;
	mcpSessions: number;
	browserSessions: number;
	activeOperations: number;
	backgroundJobs: number;
	waitingOutputJobs: number;
	targetIds: number[];
	expiresAt: number | null;
}

export type NativeResourceCloseTarget = { kind: 'app' } | { kind: 'session'; runId: string; sessionId: string };

export interface NativeResourceCloseResult {
	status: 'closed' | 'confirmation_required';
	activeRuns: number;
	activeOperations: number;
	backgroundJobs: number;
}
