import pino from 'pino';
import { normalizeLogLevel, type LogLevel } from './log-level';

const levelListeners = new Set<(level: LogLevel) => void>();

export const logger = pino({
  level: 'info',
  base: { service: 'nexus-backend' },
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: { err: pino.stdSerializers.err },
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
      'req.headers.authorization',
      'req.headers.cookie',
    ],
    censor: '[REDACTED]',
  },
});

const logLevelChanged = (previousLevel: LogLevel, level: LogLevel): void => {
  const context = { previousLevel, logLevel: level };
  if (logger.isLevelEnabled('info')) logger.info(context, 'Backend log level changed');
  else if (logger.isLevelEnabled('warn')) logger.warn(context, 'Backend log level changed');
  else if (logger.isLevelEnabled('error')) logger.error(context, 'Backend log level changed');
};

export const setBackendLogLevel = (value: unknown, announceChange = false): LogLevel => {
  const level = normalizeLogLevel(value);
  const previousLevel = getBackendLogLevel();
  if (level === previousLevel) return level;

  // A transition to silent must be announced before muting the logger. The call is synchronous,
  // so no unrelated log can slip through between this notice and the level assignment.
  if (announceChange && level === 'silent') logLevelChanged(previousLevel, level);
  logger.level = level;
  for (const listener of levelListeners) listener(level);
  if (announceChange && level !== 'silent') logLevelChanged(previousLevel, level);
  return level;
};

export const getBackendLogLevel = (): LogLevel => normalizeLogLevel(logger.level);

export const onBackendLogLevelChange = (listener: (level: LogLevel) => void): (() => void) => {
  levelListeners.add(listener);
  return () => levelListeners.delete(listener);
};
