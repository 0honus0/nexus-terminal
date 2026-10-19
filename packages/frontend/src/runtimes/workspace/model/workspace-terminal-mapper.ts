import type { TerminalViewport } from '@/features/terminal/public';
import type { TerminalDirectoryQueueState } from '@/features/filesystem/public';
import type { WorkspaceTerminalDirectoryChangeQueued } from '@nexus-terminal/shared/remote/terminal/workspace';
import {
	readWorkspaceTerminalInput,
	readWorkspaceTerminalResize,
} from '@nexus-terminal/shared/remote/terminal/workspace-codec';
import type { WorkspaceTerminalInput, WorkspaceTerminalResize } from '@nexus-terminal/shared/remote/terminal/workspace';

export function toTerminalInputRequest(data: string): WorkspaceTerminalInput {
	return readWorkspaceTerminalInput({ data });
}

export function toTerminalResizeRequest(viewport: TerminalViewport): WorkspaceTerminalResize {
	return readWorkspaceTerminalResize({ columns: viewport.columns, rows: viewport.rows });
}

export function toTerminalDirectoryQueue(value: WorkspaceTerminalDirectoryChangeQueued): TerminalDirectoryQueueState {
	return { path: value.path, waitingForPrompt: value.waitingForPrompt };
}
