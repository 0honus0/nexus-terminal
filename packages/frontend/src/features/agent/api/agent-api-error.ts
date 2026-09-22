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

export const formatAgentApiError = (cause: unknown, fallback: string): string => {
  const error = toAgentApiError(cause);
  if (error.status !== undefined && error.status >= 500) return fallback;
  if (error.message && error.message !== 'AGENT_REQUEST_FAILED') return error.message;
  if (error.code && error.code !== 'AGENT_REQUEST_FAILED') return error.code;
  return fallback;
};
