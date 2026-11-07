import type { AgentResourceSessionState } from '@nexus-terminal/shared/agent/runs/values';

export interface ToolResourceSnapshot {
	id: string;
	runId: string;
	phase: AgentResourceSessionState;
	createdAt: number;
	lastUsedAt: number;
	protocolSessions: number;
	browserSessions: number;
	connections: number;
	files: number;
	operations: number;
	targets: number[];
}
