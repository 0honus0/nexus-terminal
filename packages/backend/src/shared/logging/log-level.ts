export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'silent'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export const isLogLevel = (value: unknown): value is LogLevel =>
  typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value);

export const normalizeLogLevel = (value: unknown, fallback: LogLevel = 'info'): LogLevel =>
  isLogLevel(value) ? value : fallback;
