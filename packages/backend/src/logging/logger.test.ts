import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setLogLevel, installConsoleLogging, type LogLevel } from './logger';

describe('logging/logger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('setLogLevel', () => {
    it('应该接受有效的日志等级', () => {
      const validLevels: LogLevel[] = ['debug', 'info', 'warn', 'error', 'silent'];
      for (const level of validLevels) {
        expect(() => setLogLevel(level)).not.toThrow();
      }
    });
  });

  describe('installConsoleLogging', () => {
    it('应该可以调用而不抛出错误', () => {
      expect(() => installConsoleLogging()).not.toThrow();
    });
  });
});
