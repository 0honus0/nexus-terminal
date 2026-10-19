import type { ConnectionSummary } from '@/features/connections/public';

export type WorkspaceLifecycleState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';

export interface WorkspaceDescriptor {
	id: string;
	connectionId: number;
	connectionName: string;
	connection: ConnectionSummary;
	state: WorkspaceLifecycleState;
	statusMessage?: string;
	markedForSuspend: boolean;
	createdAt: number;
}
