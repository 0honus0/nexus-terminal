import axios from 'axios';

interface AgentErrorEnvelope {
  error?: {
    code?: unknown;
    message?: unknown;
    details?: unknown;
  };
  requestId?: unknown;
}

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value : undefined;

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

  if (axios.isAxiosError<AgentErrorEnvelope>(cause)) {
    const payload = cause.response?.data;
    const code = nonEmptyString(payload?.error?.code) ?? 'AGENT_REQUEST_FAILED';
    const message = nonEmptyString(payload?.error?.message) ?? code;
    return new AgentApiError({
      code,
      message,
      ...(cause.response?.status === undefined ? {} : { status: cause.response.status }),
      ...(payload?.error?.details === undefined ? {} : { details: payload.error.details }),
      ...(nonEmptyString(payload?.requestId) ? { requestId: nonEmptyString(payload?.requestId) } : {}),
    });
  }

  if (cause instanceof Error) {
    return new AgentApiError({ code: 'AGENT_REQUEST_FAILED', message: cause.message || 'AGENT_REQUEST_FAILED' });
  }

  return new AgentApiError({ code: 'AGENT_REQUEST_FAILED', message: 'AGENT_REQUEST_FAILED' });
};

export const formatAgentApiError = (cause: unknown, fallback: string): string => {
  const error = toAgentApiError(cause);
  if (error.message && error.message !== 'AGENT_REQUEST_FAILED') return error.message;
  if (error.code && error.code !== 'AGENT_REQUEST_FAILED') return error.code;
  return fallback;
};
