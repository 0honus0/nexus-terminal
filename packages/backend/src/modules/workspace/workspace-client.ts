/**
 * Minimal client transport contract required by Workspace runtime state.
 *
 * The Workspace module deliberately does not import the WebSocket interface
 * package. The concrete `ws` AuthenticatedWebSocket object structurally
 * satisfies this contract at the protocol boundary.
 */
export interface WorkspaceClient {
  userId?: number;
  username?: string;
  sessionId?: string;
  isAlive?: boolean;
  readyState: number;
  readonly OPEN: number;
  bufferedAmount: number;
  send(data: unknown, callback?: (error?: Error) => void): void;
  send(data: unknown, options: unknown, callback?: (error?: Error) => void): void;
  close(code?: number, reason?: string | Buffer): void;
}
