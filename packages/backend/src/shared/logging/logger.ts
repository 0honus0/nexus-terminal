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

export const setBackendLogLevel = (value: unknown): LogLevel => {
  const level = normalizeLogLevel(value);
  logger.level = level;
  for (const listener of levelListeners) listener(level);
  return level;
};

export const getBackendLogLevel = (): LogLevel => normalizeLogLevel(logger.level);

export const onBackendLogLevelChange = (listener: (level: LogLevel) => void): (() => void) => {
  levelListeners.add(listener);
  return () => levelListeners.delete(listener);
};
