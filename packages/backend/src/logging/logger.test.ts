import { describe, it, expect } from 'vitest';
import { redactSensitiveData, redactLogArgs, type LogLevel } from './logger';

describe('logging/logger', () => {
  describe('从 redaction 模块重新导出', () => {
    it('应该导出 redactSensitiveData 函数', () => {
      expect(typeof redactSensitiveData).toBe('function');
    });

    it('应该导出 redactLogArgs 函数', () => {
      expect(typeof redactLogArgs).toBe('function');
    });

    it('redactSensitiveData 应该对密码字段脱敏', () => {
      const input = { password: 'secret123' };
      const result = redactSensitiveData(input);
      expect(result).toEqual({ password: '[REDACTED]' });
    });

    it('redactLogArgs 应该对参数列表中的敏感数据脱敏', () => {
      const args = [{ token: 'abc123' }, 'some message'];
      const result = redactLogArgs(args);
      expect(result[0]).toEqual({ token: '[REDACTED]' });
    });
  });

  describe('LogLevel 类型', () => {
    it('应该包含所有有效的日志等级', () => {
      const validLevels: LogLevel[] = ['debug', 'info', 'warn', 'error', 'silent'];
      expect(validLevels).toHaveLength(5);
      for (const level of validLevels) {
        expect(['debug', 'info', 'warn', 'error', 'silent']).toContain(level);
      }
    });
  });
});
