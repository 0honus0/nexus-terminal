/** Shared protocol values, isolated from requests and application objects. */
import { REMOTE_FILE_MAX_PATH_BYTES } from '../files/values.js';

export const WORKSPACE_UPLOAD_MAX_CHUNK_BYTES = 1024 * 1024;

export const WORKSPACE_TRANSFER_MAX_INLINE_PREVIEW_BYTES = 20 * 1024 * 1024;

export const WORKSPACE_TRANSFER_MAX_PATH_BYTES = REMOTE_FILE_MAX_PATH_BYTES;

export const WORKSPACE_TRANSFER_MAX_TASK_ID_BYTES = 512;

export const WORKSPACE_TRANSFER_MAX_SOURCES = 64;

export const WORKSPACE_UPLOAD_MAX_PREPARE_DIRECTORIES = 20_000;

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
