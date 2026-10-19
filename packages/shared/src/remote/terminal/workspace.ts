import type { WorkspaceDirectoryChangeFailureCode } from './values.js';

export interface WorkspaceTerminalInput {
	data: string;
}

export interface WorkspaceTerminalFlow {
	consumedBytes: number;
}

export interface WorkspaceTerminalResize {
	columns: number;
	rows: number;
}

export interface WorkspaceTerminalChangeDirectory {
	path: string;
}

export interface WorkspaceTerminalDirectoryChangeQueued {
	requestId: string;
	path: string;
	waitingForPrompt: boolean;
}

export interface WorkspaceTerminalDirectoryChanged {
	requestId: string;
	path: string;
}

export interface WorkspaceTerminalDirectoryChangeFailed {
	requestId: string;
	message: WorkspaceDirectoryChangeFailureCode;
}

export interface WorkspaceTerminalRequests {
	'terminal.input': WorkspaceTerminalInput;
	'terminal.flow': WorkspaceTerminalFlow;
	'terminal.resize': WorkspaceTerminalResize;
	'terminal.currentDirectory': Record<string, never>;
	'terminal.changeDirectory': WorkspaceTerminalChangeDirectory;
}

export interface WorkspaceTerminalResponses {
	'terminal.input': null;
	'terminal.flow': null;
	'terminal.resize': null;
	'terminal.currentDirectory': string;
	'terminal.changeDirectory': { queued: true };
}

export interface WorkspaceTerminalEvents {
	'terminal.closed': Record<string, never>;
	'terminal.error': { message: 'remote_unavailable' };
	'terminal.directoryChangeQueued': WorkspaceTerminalDirectoryChangeQueued;
	'terminal.directoryChanged': WorkspaceTerminalDirectoryChanged;
	'terminal.directoryChangeFailed': WorkspaceTerminalDirectoryChangeFailed;
}
