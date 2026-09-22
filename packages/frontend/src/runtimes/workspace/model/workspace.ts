import type {
  WorkspaceConnectResponseDto,
  WorkspaceSuspendResumeResponseDto,
} from '@nexus-terminal/protocol/workspace';
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

type WorkspaceResumeFields = Omit<WorkspaceSuspendResumeResponseDto, keyof WorkspaceConnectResponseDto>;
export type WorkspaceConnectResult = WorkspaceConnectResponseDto & Partial<WorkspaceResumeFields>;
