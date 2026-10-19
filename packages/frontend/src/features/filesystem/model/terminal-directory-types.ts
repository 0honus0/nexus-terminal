import type { WorkspaceDirectoryChangeFailureCode } from '@nexus-terminal/shared/remote/terminal/values';
import type { WorkspaceErrorCode } from '@nexus-terminal/shared/remote/workspace/values';

export interface TerminalDirectoryQueueState {
	path: string;
	waitingForPrompt: boolean;
}

export class TerminalDirectoryFailure extends Error {
	constructor(
		readonly code: WorkspaceDirectoryChangeFailureCode | WorkspaceErrorCode | 'protocol_error' | 'not_connected',
		options?: ErrorOptions,
	) {
		super(code, options);
		this.name = 'TerminalDirectoryFailure';
	}
}
