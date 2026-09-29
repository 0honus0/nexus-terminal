import type { WorkspaceSuspendMarkResponseDto } from '@nexus-terminal/protocol/workspace';

/** Suspends one active Workspace into the server-owned session catalog. Resume creates a new runtime session. */
export interface SshSuspendChannel {
  mark(workspaceId: string, terminalSnapshot: () => Promise<string>): Promise<WorkspaceSuspendMarkResponseDto>;
  unmark(workspaceId: string): Promise<void>;
}
