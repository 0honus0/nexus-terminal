/** Suspends one active Workspace into the server-owned session catalog. Resume creates a new runtime session. */
export interface SshSuspendChannel {
  mark(workspaceId: string, terminalSnapshot?: string): Promise<{ suspendedSessionId: string }>;
  unmark(workspaceId: string): Promise<void>;
}
