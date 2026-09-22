import pino from 'pino';

export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'silent'] as const;
export type LogLevelDto = (typeof LOG_LEVELS)[number];

export const isLogLevel = (value: unknown): value is LogLevelDto =>
  typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value);

export const logger = pino({
  level: 'info',
  browser: { asObject: true },
  redact: {
    paths: [
      'password',
      'passphrase',
      'secret',
      'token',
      'authorization',
      'cookie',
      '*.password',
      '*.passphrase',
      '*.secret',
      '*.token',
      '*.authorization',
      '*.cookie',
      'err.config.headers.Authorization',
      'err.config.headers.authorization',
    ],
    censor: '[REDACTED]',
  },
});

const logLevelChanged = (previousLevel: LogLevelDto, level: LogLevelDto): void => {
  const context = { previousLevel, logLevel: level };
  if (logger.isLevelEnabled('info')) logger.info(context, 'Frontend log level changed');
  else if (logger.isLevelEnabled('warn')) logger.warn(context, 'Frontend log level changed');
  else if (logger.isLevelEnabled('error')) logger.error(context, 'Frontend log level changed');
};

export const setFrontendLogLevel = (value: unknown, announceChange = false): LogLevelDto => {
  const level: LogLevelDto = isLogLevel(value) ? value : 'info';
  const previousLevel: LogLevelDto = isLogLevel(logger.level) ? logger.level : 'info';
  if (level === previousLevel) return level;

  if (announceChange && level === 'silent') logLevelChanged(previousLevel, level);
  logger.level = level;
  if (announceChange && level !== 'silent') logLevelChanged(previousLevel, level);
  return level;
};
