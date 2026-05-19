import { describe, it, expect } from 'vitest';
import { convertLineEnding, detectLineEnding } from './lineEnding';

describe('convertLineEnding', () => {
  describe('LF 转换', () => {
    it('LF 转 LF 应保持不变', () => {
      const input = 'line1\nline2\nline3';
      expect(convertLineEnding(input, 'lf')).toBe(input);
    });

    it('CRLF 转 LF', () => {
      const input = 'line1\r\nline2\r\nline3';
      expect(convertLineEnding(input, 'lf')).toBe('line1\nline2\nline3');
    });

    it('CR 转 LF', () => {
      const input = 'line1\rline2\rline3';
      expect(convertLineEnding(input, 'lf')).toBe('line1\nline2\nline3');
    });
  });

  describe('CRLF 转换', () => {
    it('LF 转 CRLF', () => {
      const input = 'line1\nline2\nline3';
      expect(convertLineEnding(input, 'crlf')).toBe('line1\r\nline2\r\nline3');
    });

    it('CRLF 转 CRLF 应保持不变', () => {
      const input = 'line1\r\nline2\r\nline3';
      expect(convertLineEnding(input, 'crlf')).toBe(input);
    });

    it('CR 转 CRLF', () => {
      const input = 'line1\rline2\rline3';
      expect(convertLineEnding(input, 'crlf')).toBe('line1\r\nline2\r\nline3');
    });
  });

  describe('CR 转换', () => {
    it('LF 转 CR', () => {
      const input = 'line1\nline2\nline3';
      expect(convertLineEnding(input, 'cr')).toBe('line1\rline2\rline3');
    });

    it('CRLF 转 CR', () => {
      const input = 'line1\r\nline2\r\nline3';
      expect(convertLineEnding(input, 'cr')).toBe('line1\rline2\rline3');
    });

    it('CR 转 CR 应保持不变', () => {
      const input = 'line1\rline2\rline3';
      expect(convertLineEnding(input, 'cr')).toBe(input);
    });
  });

  describe('混合换行符', () => {
    it('应将所有换行符统一转换为目标格式', () => {
      const input = 'line1\r\nline2\nline3\rline4';
      expect(convertLineEnding(input, 'lf')).toBe('line1\nline2\nline3\nline4');
      expect(convertLineEnding(input, 'crlf')).toBe('line1\r\nline2\r\nline3\r\nline4');
      expect(convertLineEnding(input, 'cr')).toBe('line1\rline2\rline3\rline4');
    });
  });

  describe('边界情况', () => {
    it('空字符串应返回空字符串', () => {
      expect(convertLineEnding('', 'lf')).toBe('');
      expect(convertLineEnding('', 'crlf')).toBe('');
      expect(convertLineEnding('', 'cr')).toBe('');
    });

    it('没有换行符的内容应保持不变', () => {
      const input = 'no line endings here';
      expect(convertLineEnding(input, 'lf')).toBe(input);
      expect(convertLineEnding(input, 'crlf')).toBe(input);
      expect(convertLineEnding(input, 'cr')).toBe(input);
    });

    it('应正确处理连续换行符', () => {
      const input = 'line1\n\n\nline2';
      expect(convertLineEnding(input, 'crlf')).toBe('line1\r\n\r\n\r\nline2');
    });
  });
});

describe('detectLineEnding', () => {
  describe('单一换行符类型', () => {
    it('应检测纯 LF', () => {
      const content = 'line1\nline2\nline3';
      expect(detectLineEnding(content)).toBe('lf');
    });

    it('应检测纯 CRLF', () => {
      const content = 'line1\r\nline2\r\nline3';
      expect(detectLineEnding(content)).toBe('crlf');
    });

    it('应检测纯 CR', () => {
      const content = 'line1\rline2\rline3';
      expect(detectLineEnding(content)).toBe('cr');
    });
  });

  describe('混合换行符', () => {
    it('应返回主导的换行符类型', () => {
      // CRLF 占多数
      const mixed1 = 'line1\r\nline2\r\nline3\n';
      expect(detectLineEnding(mixed1)).toBe('crlf');

      // LF 占多数
      const mixed2 = 'line1\nline2\nline3\r\n';
      expect(detectLineEnding(mixed2)).toBe('lf');
    });
  });

  describe('边界情况', () => {
    it('空字符串应返回 lf', () => {
      expect(detectLineEnding('')).toBe('lf');
    });

    it('没有换行符的内容应返回 lf', () => {
      expect(detectLineEnding('no line endings')).toBe('lf');
    });

    it('应正确处理单行内容', () => {
      expect(detectLineEnding('single line')).toBe('lf');
      expect(detectLineEnding('single line\r\n')).toBe('crlf');
    });
  });
});
