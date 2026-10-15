export const BACKEND_LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const;

export type BackendLogLevel = (typeof BACKEND_LOG_LEVELS)[number];
