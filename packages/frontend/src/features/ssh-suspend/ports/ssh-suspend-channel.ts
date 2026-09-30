import type { WorkspaceSuspendMarkResponseDto } from '@nexus-terminal/protocol/workspace';

/** Registers an active Workspace for retention without detaching its current owner. */
export interface SshSuspendChannel {
  mark(workspaceId: string, terminalSnapshot: () => Promise<string>): Promise<WorkspaceSuspendMarkResponseDto>;
  unmark(workspaceId: string): Promise<void>;
}
