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
  return {
    ok: false,
    summary: `${context.summaryPrefix}: ${code}`,
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
