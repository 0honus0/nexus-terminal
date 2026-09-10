import pino from 'pino';

export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const isLogLevel = (value: unknown): value is LogLevel =>
  typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value);

export const logger = pino({
  level: 'info',
  browser: { asObject: true },
});

export const setFrontendLogLevel = (value: unknown): LogLevel => {
  const level: LogLevel = isLogLevel(value) ? value : 'info';
  logger.level = level;
  return level;
};
