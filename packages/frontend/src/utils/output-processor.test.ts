import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OutputProcessor, OutputType } from './output-processor';

describe('OutputProcessor', () => {
  let processor: OutputProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = new OutputProcessor();
  });

  describe('detectType', () => {
    it('应该检测 JSON 输出', () => {
      const result = processor.process('{"key": "value", "count": 42}');
      expect(result.type).toBe(OutputType.JSON);
    });

    it('应该检测 YAML 输出', () => {
      const result = processor.process('name: test\nversion: 1.0\ndescription: hello');
      expect(result.type).toBe(OutputType.YAML);
    });

    it('应该检测 LOG 输出', () => {
      const result = processor.process('2024-01-15 10:30:00 INFO Server started');
      expect(result.type).toBe(OutputType.LOG);
    });

    it('应该检测 TABLE 输出（分隔符格式）', () => {
      const result = processor.process(
        '+----+------+\n| ID | Name |\n+----+------+\n| 1  | test |'
      );
      expect(result.type).toBe(OutputType.TABLE);
    });

    it('应该检测 TABLE 输出（空格对齐格式）', () => {
      const result = processor.process(
        'ID    Name    Status\n1     test    active\n2     prod    inactive'
      );
      expect(result.type).toBe(OutputType.TABLE);
    });

    it('应该返回 TEXT 类型对于普通文本', () => {
      const result = processor.process('Hello world\nThis is plain text');
      expect(result.type).toBe(OutputType.TEXT);
    });

    it('应该返回 TEXT 类型对于空输入', () => {
      const result = processor.process('');
      expect(result.type).toBe(OutputType.TEXT);
    });
  });

  describe('JSON 高亮', () => {
    it('应该格式化 JSON 输出', () => {
      const result = processor.process('{"name":"test","count":42}');
      expect(result.type).toBe(OutputType.JSON);
      // 验证输出包含 ANSI 高亮码
      expect(result.content).toContain('\x1b[');
    });
  });

  describe('YAML 高亮', () => {
    it('应该高亮 YAML 键值对', () => {
      const result = processor.process('key: value\nnumber: 42');
      expect(result.type).toBe(OutputType.YAML);
      expect(result.content).toContain('\x1b[');
    });
  });

  describe('LOG 高亮', () => {
    it('应该高亮日志级别', () => {
      const result = processor.process('ERROR: Something failed');
      expect(result.type).toBe(OutputType.LOG);
      expect(result.content).toContain('\x1b[');
    });
  });

  describe('元数据', () => {
    it('应该计算行数', () => {
      const result = processor.process('line1\nline2\nline3');
      expect(result.metadata?.lineCount).toBe(3);
    });

    it('应该标记长输出', () => {
      const processor2 = new OutputProcessor({ foldThreshold: 5 });
      const longOutput = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n');
      const result = processor2.process(longOutput);
      expect(result.metadata?.isLong).toBe(true);
      expect(result.metadata?.shouldFold).toBe(true);
    });

    it('不应该标记短输出为长', () => {
      const result = processor.process('short output');
      expect(result.metadata?.isLong).toBe(false);
    });
  });

  describe('配置选项', () => {
    it('应该禁用高亮', () => {
      const processor2 = new OutputProcessor({ enableHighlight: false });
      const result = processor2.process('{"key":"value"}');
      expect(result.type).toBe(OutputType.JSON);
      // 禁用高亮后不应包含 ANSI 码
      expect(result.content).not.toContain('\x1b[');
    });

    it('应该禁用表格格式化', () => {
      const processor2 = new OutputProcessor({ enableTableFormat: false });
      const result = processor2.process('+----+------+\n| ID | Name |\n+----+------+');
      expect(result.type).toBe(OutputType.TABLE);
      expect(result.content).not.toContain('\x1b[');
    });

    it('应该禁用链接检测', () => {
      const processor2 = new OutputProcessor({ enableLinkDetection: false });
      const result = processor2.process('Visit https://example.com');
      expect(result.content).not.toContain('\x1b[');
    });

    it('应该设置自定义折叠阈值', () => {
      processor.setFoldThreshold(3);
      const longOutput = Array.from({ length: 5 }, (_, i) => `line ${i}`).join('\n');
      const result = processor.process(longOutput);
      expect(result.metadata?.shouldFold).toBe(true);
      expect(result.metadata?.foldThreshold).toBe(3);
    });
  });

  describe('ANSI 码处理', () => {
    it('应该去除输入中的 ANSI 码', () => {
      const input = '\x1b[31mred text\x1b[0m normal';
      const result = processor.process(input);
      expect(result.content).not.toContain('\x1b[');
    });
  });

  describe('换行符规范化', () => {
    it('应该将 CRLF 转换为 LF', () => {
      const result = processor.process('line1\r\nline2');
      expect(result.metadata?.lineCount).toBe(2);
    });
  });
});
