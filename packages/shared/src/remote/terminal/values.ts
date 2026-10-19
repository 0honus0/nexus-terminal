export const WORKSPACE_DIRECTORY_CHANGE_FAILURE_CODES = [
	'replaced',
	'prompt_timeout',
	'directory_unchanged',
	'verification_failed',
	'change_failed',
] as const;

export type WorkspaceDirectoryChangeFailureCode = (typeof WORKSPACE_DIRECTORY_CHANGE_FAILURE_CODES)[number];
