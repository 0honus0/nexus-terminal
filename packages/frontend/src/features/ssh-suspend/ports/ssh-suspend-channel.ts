/** Live suspend marking capability for one active Workspace. Resume creates a new runtime session and is owned by the runtime. */
export interface SshSuspendChannel {
  mark(workspaceId: string, terminalSnapshot?: string): Promise<void>;
  unmark(workspaceId: string): Promise<void>;
}
