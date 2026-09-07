import type { RemoteShellSession } from '../../platform/execution/remote-execution.port';

/** Runtime ownership record for one interactive workspace. No WebSocket or ssh2 state belongs here. */
export interface WorkspaceSession {
  id: string;
  userId: number;
  connectionId: number;
  connectionName: string;
  executionSessionId: string;
  shell: RemoteShellSession;
  createdAt: number;
}
