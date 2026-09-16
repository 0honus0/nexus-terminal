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
