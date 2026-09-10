import pino from 'pino';

export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const isLogLevel = (value: unknown): value is LogLevel =>
  typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value);

export const logger = pino({
  level: 'info',
  browser: { asObject: true },
});

const logLevelChanged = (previousLevel: LogLevel, level: LogLevel): void => {
  const context = { previousLevel, logLevel: level };
  if (logger.isLevelEnabled('info')) logger.info(context, 'Frontend log level changed');
  else if (logger.isLevelEnabled('warn')) logger.warn(context, 'Frontend log level changed');
  else if (logger.isLevelEnabled('error')) logger.error(context, 'Frontend log level changed');
};

export const setFrontendLogLevel = (value: unknown, announceChange = false): LogLevel => {
  const level: LogLevel = isLogLevel(value) ? value : 'info';
  const previousLevel: LogLevel = isLogLevel(logger.level) ? logger.level : 'info';
  if (level === previousLevel) return level;

  if (announceChange && level === 'silent') logLevelChanged(previousLevel, level);
  logger.level = level;
  if (announceChange && level !== 'silent') logLevelChanged(previousLevel, level);
  return level;
};
