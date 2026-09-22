export interface MarkedSuspendedSessionState {
  workspaceId: string;
  connectionId: number;
  connectionName: string;
  markedAt: string;
}

export type {
  SuspendedSessionDto,
  SuspendedSessionOwnershipStateDto,
  SuspendedSessionStatusDto,
} from '@nexus-terminal/protocol/ssh-suspend';

export type { WorkspaceSuspendResumeRequestDto } from '@nexus-terminal/protocol/workspace';
