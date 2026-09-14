import { logger } from '@/client/logging/logger';

let registered = false;

const normalizeError = (value: unknown): Error => {
  if (value instanceof Error) return value;
  if (typeof value === 'string') return new Error(value);
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error(String(value));
  }
};

const pageContext = (): Record<string, unknown> => ({
  visibilityState: document.visibilityState,
  pathname: window.location.pathname,
});

export const registerGlobalRuntimeDiagnostics = (): void => {
  if (registered) return;
  registered = true;

  window.addEventListener('error', (event) => {
    logger.error(
      {
        err: normalizeError(event.error ?? event.message),
        source: 'window.error',
        filename: event.filename || undefined,
        line: event.lineno || undefined,
        column: event.colno || undefined,
        ...pageContext(),
      },
      'Unhandled frontend error',
    );
  });

  window.addEventListener('unhandledrejection', (event) => {
    logger.error(
      {
        err: normalizeError(event.reason),
        source: 'window.unhandledrejection',
        ...pageContext(),
      },
      'Unhandled frontend promise rejection',
    );
  });
};
