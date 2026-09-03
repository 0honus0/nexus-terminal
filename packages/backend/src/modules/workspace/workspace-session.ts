import type { ClientChannel } from 'ssh2';
import type { StringDecoder } from 'string_decoder';
import type { ExecutionSession } from '../../platform/execution/execution-session';
import type { WorkspaceClient } from './workspace-client';

/**
 * Runtime state for one interactive Workspace connection.
 *
 * This is deliberately separate from ExecutionSession. Workspace UI state can
 * disappear while Agent/System execution sessions continue independently.
 */
export interface WorkspaceSession {
  ws: WorkspaceClient;
  uploadWs?: WorkspaceClient;
  executionSession: ExecutionSession;
  sshShellStream?: ClientChannel;
  dbConnectionId: number;
  connectionName?: string;
  statusIntervalId?: NodeJS.Timeout;
  ipAddress?: string;
  isShellReady?: boolean;
  isSuspendedByService?: boolean;
  isMarkedForSuspend?: boolean;
  suspendLogPath?: string;
  shellPid?: number;
  shellKind?: 'bash' | 'zsh' | 'other';
  shellAtPrompt?: boolean;
  shellIntegrationReady?: boolean;
  shellProbePromise?: Promise<void>;
  shellProbeResolve?: () => void;
  shellProbeReject?: (error: Error) => void;
  shellHookPromise?: Promise<void>;
  shellHookResolve?: () => void;
  shellHookReject?: (error: Error) => void;
  shellHookPromptTimeout?: NodeJS.Timeout;
  shellSetup?: {
    phase: 'probe' | 'hook';
    startMarker: string;
    endMarker: string;
    buffer: string;
    timeout: NodeJS.Timeout;
  };
  shellControlRemainder?: string;
  suppressOutputUntilPrompt?: boolean;
  pendingDirectoryChange?: {
    requestId: string;
    path: string;
    expectedPath: string;
    executing: boolean;
    timeout: NodeJS.Timeout;
  };
  terminalOutputSequence?: number;
  terminalOutputHold?: boolean;
  resumeSuspendSessionId?: string;
  sshInputQueue?: Array<{ data: string; sequence?: number; bytes: number }>;
  sshInputWaitingForDrain?: boolean;
  shellOutputDecoder?: StringDecoder;
  shellStderrDecoder?: StringDecoder;
  terminalCols?: number;
  terminalRows?: number;
}
