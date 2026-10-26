import type { WorkspaceArchiveFormat, WorkspaceArchiveOperation, WorkspaceArchiveTool } from '../transfers/values.js';

export const REMOTE_TOOLS = [
	'ssh',
	'scp',
	'sshpass',
	'rsync',
	'zip',
	'unzip',
	'zipinfo',
	'tar',
	'gzip',
	'bzip2',
	'xz',
	'cp',
	'ln',
	'od',
	'grep',
] as const;

export type RemoteTool = (typeof REMOTE_TOOLS)[number];

export const TOOL_PACKAGE_MANAGERS = ['apt-get', 'dnf', 'yum', 'apk', 'zypper', 'pacman'] as const;

export type ToolPackageManager = (typeof TOOL_PACKAGE_MANAGERS)[number];

export const TOOL_PRIVILEGES = ['root', 'sudo', 'password', 'unavailable'] as const;

export type ToolPrivilege = (typeof TOOL_PRIVILEGES)[number];

export const TOOL_ERROR_CODES = [
	'invalid_input',
	'unauthenticated',
	'forbidden',
	'not_found',
	'host_key_untrusted',
	'stale_plan',
	'conflict',
	'unsupported',
	'authentication_failed',
	'installation_failed',
	'connection_unavailable',
	'unavailable',
	'operation_unknown',
	'limit_exceeded',
	'shutting_down',
] as const;

export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number];

export const TOOL_BODY_MAX_BYTES = 64 * 1024;

export const TOOL_RESPONSE_MAX_BYTES = 16 * 1024;

export const TOOL_PASSWORD_MAX_BYTES = 8192;

export function isToolPassword(value: unknown): value is string {
	if (typeof value !== 'string' || !value.length || /[\r\n\0]/u.test(value)) {
		return false;
	}
	const bytes = new TextEncoder().encode(value);
	return (
		bytes.length <= TOOL_PASSWORD_MAX_BYTES && new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes) === value
	);
}

/** Includes tools used by verification and publication, not just the archive writer. */
export function archiveToolRequirements(
	format: WorkspaceArchiveFormat,
	operation: WorkspaceArchiveOperation,
): WorkspaceArchiveTool[] {
	if (format === 'zip') {
		return operation === 'compress' ? ['zip', 'unzip'] : ['unzip', 'zipinfo', 'od', 'grep', 'cp', 'ln'];
	}
	return [
		'tar',
		format === 'tar.gz' ? 'gzip' : 'bzip2',
		...(operation === 'decompress' ? (['cp', 'ln', 'od'] as const) : []),
	];
}
