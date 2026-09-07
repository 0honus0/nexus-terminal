import type { Connection } from '@/features/connections/public';

export type WorkspaceLifecycleState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';

export interface WorkspaceDescriptor {
  id: string;
  connectionId: number;
  connectionName: string;
  connection: Connection;
  state: WorkspaceLifecycleState;
  statusMessage?: string;
  markedForSuspend: boolean;
  createdAt: number;
}

export interface WorkspaceConnectResult {
  workspaceId: string;
  connectionId: number;
  connectionName: string;
}
