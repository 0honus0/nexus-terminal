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
const providerErrorTable: ReadonlyArray<readonly [RegExp, string]> = [
  [/^PROVIDER_(?:RESPONSE_INVALID|RESPONSE_EMPTY|STREAM_TRUNCATED)$/, 'providerResponse'],
  [/^PROVIDER_DNS_FAILED$/, 'providerDns'],
  [/^PROVIDER_TLS_FAILED$/, 'providerTls'],
  [/^PROVIDER_NETWORK_FAILED$/, 'providerNetwork'],
  [/^PROVIDER_REQUEST_FAILED$/, 'providerRequest'],
  [/^PROVIDER_(?:HTTP_401|AUTH_FAILED)$/, 'authentication'],
  [/^PROVIDER_HTTP_403$/, 'forbidden'],
  [/^PROVIDER_HTTP_429$/, 'busy'],
  [/^PROVIDER_(?:HTTP_(?:408|504)|\w+_TIMEOUT)$/, 'timeout'],
  [/^PROVIDER_HTTP_4\d\d$/, 'providerRejected'],
  [/^PROVIDER_HTTP_5\d\d$/, 'providerUpstream'],
];
export const providerErrorCategory = (code: string): string | null =>
  providerErrorTable.find(([pattern]) => pattern.test(code))?.[1] ?? null;

const classifyAgentApiError = (code: string): AgentApiErrorCategory | null => {
  return agentErrorTable.find(([pattern]) => pattern.test(code))?.[1] ?? null;
};

const agentErrorTable: ReadonlyArray<readonly [RegExp, AgentApiErrorCategory]> = [
  [/(?:AUTH_FAILED|UNAUTHORIZED|CREDENTIAL_STALE)$/, 'authentication'],
  [/(?:FORBIDDEN|DENIED|UNTRUSTED|NOT_AUTHORIZED)$/, 'forbidden'],
  [/(?:QUOTA_EXCEEDED|LIMIT_EXCEEDED|BUDGET_EXCEEDED|HARD_LIMIT_EXCEEDED|RUN_EXECUTION_LIMIT)$/, 'quota'],
  [/(?:TOO_LARGE|PAYLOAD_TOO_LARGE|ARCHIVE_TOO_MANY_FILES)$/, 'tooLarge'],
  [/(?:TIMEOUT|DEADLINE_EXCEEDED)$/, 'timeout'],
  [/(?:BUSY|QUEUE_FULL|IN_PROGRESS)$/, 'busy'],
  [/(?:NOT_FOUND|MISSING)$/, 'notFound'],
  [/(?:CONFLICT|STALE|CHANGED|IMMUTABLE|ALREADY_|NO_CHANGE|RECONCILIATION_REQUIRED)$/, 'conflict'],
  [/(?:UNAVAILABLE|DISABLED|NOT_READY|NOT_CONFIGURED|UNSUPPORTED)$/, 'unavailable'],
  [
    /(?:INVALID|VALIDATION_FAILED|REQUIRED|MISMATCH|UNSAFE|TOO_DEEP|DUPLICATE_PATH|SCHEMA_VERSION_UNSUPPORTED)$/,
    'validation',
  ],
];

export const formatAgentApiError = (cause: unknown, fallback: string, t?: AgentErrorTranslator): string => {
  const error = toAgentApiError(cause);
  if (error.status === undefined) return error.message || fallback;
  const category = providerErrorCategory(error.code) ?? classifyAgentApiError(error.code);
  if (category && t) return t(`agent.apiErrors.${category}`);
  return fallback;
};
