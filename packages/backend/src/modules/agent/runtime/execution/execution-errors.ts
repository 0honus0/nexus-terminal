import type { ToolResult } from '../../capabilities/tool.types';

export interface FailedToolResultContext {
  fallbackCode: string;
  summaryPrefix: string;
  verificationSummary: string;
}

export const executionErrorCode = (error: unknown, fallbackCode: string): string => {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return 'ABORTED';
    if (/^[A-Z][A-Z0-9_]+$/.test(error.message)) return error.message;
    const code = (error as Error & { code?: unknown }).code;
    if (typeof code === 'string' && /^[A-Z][A-Z0-9_]+$/.test(code)) return code;
  }
  return fallbackCode;
};

const ERROR_DETAILS: Readonly<Record<string, string>> = {
  ACP_TARGET_CONFIGURATION_MISMATCH:
    'The selected target must match the ACP integration transport: SSH needs target=ssh/id; Workspace needs target=workspace/id or workspaceId. Configure a matching integration first.',
  ACP_TARGET_ID_CONFLICT: 'id and workspaceId identify different Workspaces; supply one ID or make them equal.',
  ACP_SSH_CWD_INVALID: 'SSH ACP cwd must be an absolute remote directory path.',
  ACP_SSH_CONFIGURATION_INVALID:
    'SSH ACP configuration requires non-empty argv (1–128 strings, executable first) and an absolute cwd; NUL and oversized fields are rejected.',
  ACP_SSH_TRANSPORT_NOT_CONFIGURED: 'The SSH ACP transport is not available; no remote ACP process was started.',
  ACP_SSH_DISCONNECTED:
    'The dedicated SSH ACP connection closed. The remote operation outcome cannot be proven; do not automatically replay the prompt.',
  ACP_SSH_PROCESS_EXIT:
    'The remote ACP process exited without a clean zero exit; verify its executable, arguments, dependencies and working directory.',
  ACP_SSH_CHANNEL_ERROR:
    'The dedicated SSH ACP command channel failed; do not infer successful completion or automatically replay.',
  ACP_SSH_STREAM_OVERFLOW:
    'ACP output exceeded the bounded unread stream buffer; the channel was terminated, not silently truncated.',
  ACP_SSH_WRITE_FAILED:
    'ACP protocol input could not be written to the remote process; verify channel state before further action.',
  FILE_PATCH_BINARY_UNSUPPORTED: 'file_patch edits UTF-8 text only; binary patch content is unsupported.',
  FILE_PATCH_CREATE_UNSUPPORTED: 'file_patch cannot create files; use file_write with content.',
  FILE_PATCH_DELETE_UNSUPPORTED: 'file_patch cannot delete files; use file_delete with explicit authorization.',
  FILE_PATCH_RENAME_UNSUPPORTED: 'file_patch must keep the same old/new path; use file_move for renaming.',
  FILE_PATCH_HUNKS_REQUIRED: 'Each file entry must include at least one unified diff hunk.',
  FILE_PATCH_REQUIRES_FILE: 'file_patch requires an existing regular file, not a directory.',
  FILE_PATCH_DUPLICATE_PATH:
    'Each resolved file path may appear only once in a patch; combine its hunks into one file entry.',
  FILE_NOT_FOUND: 'The requested filesystem path does not exist; verify its parent directory with file_list.',
  FILE_READ_REQUIRES_FILE: 'file_read requires a regular file, not a directory; use file_list for directories.',
  FILE_LIST_REQUIRES_DIRECTORY: 'file_list requires a directory; use file_read for regular files.',
  FILE_HASH_UNAVAILABLE: 'A content SHA-256 could not be confirmed; do not use this result as write authorization.',
  ARTIFACT_METADATA_RANGE_UNSUPPORTED:
    'metadata accepts no line or byte range fields; omit startLine, lineCount, startByte and maxBytes.',
  ARTIFACT_TEXT_BYTE_RANGE_CONFLICT:
    'text accepts startLine/lineCount, not startByte/maxBytes; use bytes for byte ranges.',
  ARTIFACT_BYTES_LINE_RANGE_CONFLICT:
    'bytes accepts startByte/maxBytes, not startLine/lineCount; use text for line ranges.',
  BROWSER_NODE_SNAPSHOT_PAIR_REQUIRED:
    'Provide snapshotId and nodeRef together, or omit both for session-wide key input.',
  FILE_PATCH_UNSUPPORTED:
    'Only text edits of existing regular files are supported. Use file_write for creation, file_delete for deletion, file_move for renaming; duplicate paths and binary changes are not supported.',
  FILE_PATCH_INVALID: 'Provide a valid unified diff with 1 to 16 file entries and exact hunk locations.',
  FILE_PATCH_CONTEXT_MISMATCH:
    'Patch context does not match the current file at the declared line; read the current content and regenerate an exact diff. Fuzzy matching is disabled.',
  TOOL_ARGUMENTS_INVALID:
    'Arguments are invalid; no operation was executed. Check the declared schema before retrying. shell_execute accepts kind=argv/argv or kind=shell/shellScript on both Workspace and SSH; neither command field is a display title.',
  ABORTED: 'The operation was interrupted before it completed.',
  LEASE_CONFLICT: 'Another active operation currently holds the required resource lease.',
  LEASE_LOST: 'The resource lease was lost while the operation was still in progress.',
  RESOURCE_QUARANTINED:
    'The target resource is quarantined because an earlier mutation has an unresolved or unknown outcome.',
  RECONCILIATION_REQUIRED: 'The previous mutation must be reconciled before another mutation can run.',
  APPROVAL_STALE:
    'The approved operation is no longer valid because its target, input, policy, or lease state changed.',
  REMOTE_FILE_NOT_FOUND: 'The requested remote file does not exist or is no longer available at that path.',
  ECONNREFUSED:
    'The remote host refused the connection; the SSH service may be stopped or unreachable on its configured port.',
  ECONNRESET: 'The remote connection was reset before the operation completed.',
  ETIMEDOUT: 'The remote connection timed out before the operation completed.',
  EAI_AGAIN: 'The remote host name could not be resolved because DNS resolution temporarily failed.',
};

export const executionErrorDetail = (error: unknown, code: string): string => {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message && message !== code && !/^[A-Z][A-Z0-9_]+$/.test(message)) return message.slice(0, 512);
    const cause = error.cause;
    if (cause instanceof Error) {
      const causeMessage = cause.message.trim();
      if (causeMessage && causeMessage !== code) return causeMessage.slice(0, 512);
    }
  }
  return ERROR_DETAILS[code] ?? code;
};

export const waitForRetry = (milliseconds: number, signal: AbortSignal): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error('ABORTED'));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('ABORTED'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
  });

export const failedToolResult = (error: unknown, context: FailedToolResultContext): ToolResult => {
  const code = executionErrorCode(error, context.fallbackCode);
  const detail = executionErrorDetail(error, code);
  return {
    ok: false,
    summary: `${context.summaryPrefix}: ${detail}${detail === code ? '' : ` [${code}]`}`,
    data: { error: { code, message: detail } },
    artifactRefs: [],
    truncated: false,
    outcome: 'confirmed',
    errorCode: code,
    verification: {
      status: 'failed',
      summary: context.verificationSummary,
      evidenceRefs: [],
    },
  };
};
