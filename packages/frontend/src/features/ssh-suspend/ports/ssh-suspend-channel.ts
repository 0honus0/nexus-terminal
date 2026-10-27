import type { SuspendedMarkResult } from '../model/suspended-session-types';

/** Registers an active Workspace for retention without detaching its current owner. */
export interface SshSuspendChannel {
	mark(workspaceId: string, terminalSnapshot: () => Promise<string>): Promise<SuspendedMarkResult>;
	unmark(workspaceId: string): Promise<void>;
}
