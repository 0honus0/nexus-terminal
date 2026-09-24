import axios from 'axios';

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value : undefined;

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

export class AgentApiError extends Error {
  readonly code: string;
  readonly status: number | undefined;
  readonly details: unknown;
  readonly requestId: string | undefined;

  constructor(input: { code: string; message: string; status?: number; details?: unknown; requestId?: string }) {
    super(input.message);
    this.name = 'AgentApiError';
    this.code = input.code;
    this.status = input.status;
    this.details = input.details;
    this.requestId = input.requestId;
  }
}

export const toAgentApiError = (cause: unknown): AgentApiError => {
  if (cause instanceof AgentApiError) return cause;

  if (axios.isAxiosError<unknown>(cause)) {
    const payload = record(cause.response?.data);
    const error = record(payload?.error);
    const code = nonEmptyString(error?.code) ?? 'AGENT_REQUEST_FAILED';
    const message = nonEmptyString(error?.message) ?? code;
    const requestId = nonEmptyString(payload?.requestId);
    return new AgentApiError({
      code,
      message,
      ...(cause.response?.status === undefined ? {} : { status: cause.response.status }),
      ...(error?.details === undefined ? {} : { details: error.details }),
      ...(requestId === undefined ? {} : { requestId }),
    });
  }

  if (cause instanceof Error) {
    return new AgentApiError({ code: 'AGENT_REQUEST_FAILED', message: cause.message || 'AGENT_REQUEST_FAILED' });
  }

  return new AgentApiError({ code: 'AGENT_REQUEST_FAILED', message: 'AGENT_REQUEST_FAILED' });
};

type AgentErrorTranslator = (key: string) => string;

type AgentApiErrorCategory =
  | 'validation'
  | 'notFound'
  | 'conflict'
  | 'unavailable'
  | 'forbidden'
  | 'quota'
  | 'tooLarge'
  | 'timeout'
  | 'authentication'
  | 'busy';

const classifyAgentApiError = (code: string): AgentApiErrorCategory | null => {
  if (/(?:AUTH_FAILED|UNAUTHORIZED|CREDENTIAL_STALE)$/.test(code)) return 'authentication';
  if (/(?:FORBIDDEN|DENIED|UNTRUSTED|NOT_AUTHORIZED)$/.test(code)) return 'forbidden';
  if (/(?:QUOTA_EXCEEDED|LIMIT_EXCEEDED|BUDGET_EXCEEDED|HARD_LIMIT_EXCEEDED)$/.test(code)) return 'quota';
  if (/(?:TOO_LARGE|PAYLOAD_TOO_LARGE|ARCHIVE_TOO_MANY_FILES)$/.test(code)) return 'tooLarge';
  if (/(?:TIMEOUT|DEADLINE_EXCEEDED)$/.test(code)) return 'timeout';
  if (/(?:BUSY|QUEUE_FULL|IN_PROGRESS)$/.test(code)) return 'busy';
  if (/(?:NOT_FOUND|MISSING)$/.test(code)) return 'notFound';
  if (/(?:CONFLICT|STALE|CHANGED|IMMUTABLE|ALREADY_|NO_CHANGE|RECONCILIATION_REQUIRED)$/.test(code)) return 'conflict';
  if (/(?:UNAVAILABLE|DISABLED|NOT_READY|NOT_CONFIGURED|UNSUPPORTED)$/.test(code)) return 'unavailable';
  if (
    /(?:INVALID|VALIDATION_FAILED|REQUIRED|MISMATCH|UNSAFE|TOO_DEEP|DUPLICATE_PATH|SCHEMA_VERSION_UNSUPPORTED)$/.test(
      code,
    )
  )
    return 'validation';
  return null;
};

export const formatAgentApiError = (cause: unknown, fallback: string, t?: AgentErrorTranslator): string => {
  const error = toAgentApiError(cause);
  if (error.status === undefined) return error.message || fallback;
  const category = classifyAgentApiError(error.code);
  if (category && t) return t(`agent.apiErrors.${category}`);
  return fallback;
};
