import { AGENT_DEFAULTS } from '../../agent-defaults';
import { waitForRetry } from './execution-errors';

export const shouldRetryModel = (error: unknown, currentAttemptIndex: number, signal: AbortSignal): boolean => {
  if (signal.aborted || currentAttemptIndex > AGENT_DEFAULTS.modelRetryCount) return false;
  const message = error instanceof Error ? error.message : '';
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code ?? '') : '';
  return (
    /^PROVIDER_HTTP_(429|502|503|504)$/.test(message) ||
    [
      'PROVIDER_UNAVAILABLE',
      'PROVIDER_DNS_RESOLUTION_FAILED',
      'PROVIDER_HEADERS_TIMEOUT',
      'PROVIDER_IDLE_TIMEOUT',
      'PROVIDER_STREAM_TRUNCATED',
      'ECONNRESET',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'EAI_AGAIN',
    ].includes(message) ||
    ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN'].includes(code)
  );
};

export const modelRetryDelayMs = (error: unknown, nextAttemptIndex: number): number => {
  const advice = error && typeof error === 'object' && 'retryAfterMs' in error ? error.retryAfterMs : undefined;
  const advised =
    typeof advice === 'number' && Number.isFinite(advice) && advice >= 0 ? Math.min(30000, Math.ceil(advice)) : 0;
  return Math.max((nextAttemptIndex === 2 ? 1000 : 2000) + Math.floor(Math.random() * 251), advised);
};

export const waitBeforeModelRetry = (error: unknown, nextAttemptIndex: number, signal: AbortSignal): Promise<void> =>
  waitForRetry(modelRetryDelayMs(error, nextAttemptIndex), signal);
