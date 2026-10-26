/** Shared protocol values, isolated from requests and application objects. */
import { REMOTE_FILE_MAX_PATH_BYTES } from '../files/values.js';
import type { RemoteFileErrorCode } from '../files/values.js';

export const WORKSPACE_DOWNLOAD_TICKET_TTL_SECONDS = 300;

/** Includes worst-case JSON escaping of the full path and optional Workspace selector. */
export const WORKSPACE_DOWNLOAD_MAX_JSON_BYTES = 32 * 1024;

export type WorkspaceTransferHttpErrorCode =
	RemoteFileErrorCode | 'inline_preview_too_large' | 'download_ticket_expired' | 'download_ticket_locked';

export type WorkspaceTransferTransportErrorCode = RemoteFileErrorCode | 'invalid_body';

export const WORKSPACE_UPLOAD_MAX_CHUNK_BYTES = 1024 * 1024;

export const WORKSPACE_TRANSFER_MAX_INLINE_PREVIEW_BYTES = 20 * 1024 * 1024;

export const WORKSPACE_TRANSFER_MAX_PATH_BYTES = REMOTE_FILE_MAX_PATH_BYTES;

export const WORKSPACE_TRANSFER_MAX_TASK_ID_BYTES = 512;

/** Unicode code points, matching the archive password input policy. */
export const WORKSPACE_ARCHIVE_MAX_PASSWORD_CODE_POINTS = 128;

export type WorkspaceCopyMoveMode = 'copy' | 'move';

export type WorkspaceArchiveFormat = 'zip' | 'tar.gz' | 'tar.bz2';

export type WorkspaceArchiveOperation = 'compress' | 'decompress';

export type WorkspaceUploadConflictPolicy = 'ask' | 'overwrite' | 'skip';

export type WorkspaceArchiveErrorCode =
	| 'PASSWORD_REQUIRED'
	| 'INVALID_PASSWORD'
	| 'PASSWORD_TOO_LONG'
	| 'INVALID_PASSWORD_FORMAT'
	| 'COMMAND_NOT_FOUND'
	| 'UNSUPPORTED_FORMAT'
	| 'UNSUPPORTED_ENTRY';

export const WORKSPACE_ARCHIVE_ERROR_CODES: readonly WorkspaceArchiveErrorCode[] = [
	'PASSWORD_REQUIRED',
	'INVALID_PASSWORD',
	'PASSWORD_TOO_LONG',
	'INVALID_PASSWORD_FORMAT',
	'COMMAND_NOT_FOUND',
	'UNSUPPORTED_FORMAT',
	'UNSUPPORTED_ENTRY',
];

export const WORKSPACE_ARCHIVE_TOOLS = ['zip', 'unzip', 'zipinfo', 'tar', 'od'] as const;

export type WorkspaceArchiveTool = (typeof WORKSPACE_ARCHIVE_TOOLS)[number];

export type WorkspaceArchiveWarning = 'verified_warning';
