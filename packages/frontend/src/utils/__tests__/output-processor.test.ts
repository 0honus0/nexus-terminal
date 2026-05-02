import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OutputProcessor, OutputType, outputProcessor } from '../output-processor';

describe('OutputProcessor', () => {
  let processor: OutputProcessor;

  beforeEach(() => {
    processor = new OutputProcessor();
    vi.clearAllMocks();
  });

  describe('process', () => {
    it('应该处理空字符串', () => {
      const result = processor.process('');
      expect(result.type).toBe(OutputType.TEXT);
      expect(result.content).toBe('');
      expect(result.metadata?.lineCount).toBe(0);
    });

    it('应该检测 JSON 类型', () => {
      const json = '{"key": "value", "count": 42}';
      const result = processor.process(json);
      expect(result.type).toBe(OutputType.JSON);
    });

    it('应该检测 YAML 类型', () => {
      const yaml = 'name: test\nversion: 1.0\nstatus: active';
      const result = processor.process(yaml);
      expect(result.type).toBe(OutputType.YAML);
    });

    it('应该检测 LOG 类型', () => {
      const log =
        '2024-01-15 10:30:00 INFO Server started\n2024-01-15 10:30:01 ERROR Connection failed';
      const result = processor.process(log);
      expect(result.type).toBe(OutputType.LOG);
    });

    it('应该检测 TABLE 类型', () => {
      // 表格检测要求列之间有 2+ 空格分隔，且不含 YAML key: value 格式
      const table = 'Column1  Column2  Column3\nvalue1   value2   value3\nvalue4   value5   value6';
      const result = processor.process(table);
      expect(result.type).toBe(OutputType.TABLE);
    });

    it('应该处理纯文本', () => {
      const text = 'Hello world\nThis is plain text';
      const result = processor.process(text);
      expect(result.type).toBe(OutputType.TEXT);
    });
  });

  describe('ANSI 转义码处理', () => {
    it('应该剥离 ANSI 转义码', () => {
      const input = '\x1b[31mRed text\x1b[0m normal';
      const result = processor.process(input);
      expect(result.content).not.toContain('\x1b[31m');
      expect(result.content).toContain('Red text');
    });

    it('应该剥离复杂的 ANSI 序列', () => {
      const input = '\x1b[1;32mBold Green\x1b[0m \x1b[4mUnderline\x1b[0m';
      const result = processor.process(input);
      expect(result.content).not.toContain('\x1b[');
    });
  });

  describe('JSON 高亮', () => {
    it('应该格式化 JSON', () => {
      const json = '{"key":"value"}';
      const result = processor.process(json);
      expect(result.type).toBe(OutputType.JSON);
      // 格式化后的 JSON 应该包含换行
      expect(result.content).toContain('\n');
    });
  });

  describe('长输出折叠', () => {
    it('应该标记长输出需要折叠', () => {
      const longOutput = Array(600).fill('line of text').join('\n');
      const result = processor.process(longOutput);
      expect(result.metadata?.isLong).toBe(true);
      expect(result.metadata?.shouldFold).toBe(true);
    });

    it('短输出不应该标记为长', () => {
      const shortOutput = 'short output';
      const result = processor.process(shortOutput);
      expect(result.metadata?.isLong).toBe(false);
    });
  });

  describe('大文件保护', () => {
    it('超过 5000 行应该跳过高亮', () => {
      const hugeOutput = Array(6000).fill('line of text').join('\n');
      const result = processor.process(hugeOutput);
      expect(result.type).toBe(OutputType.TEXT);
      expect(result.metadata?.lineCount).toBeGreaterThan(5000);
    });
  });

  describe('配置选项', () => {
    it('禁用高亮时应该返回原始文本', () => {
      const noHighlight = new OutputProcessor({ enableHighlight: false });
      const json = '{"key": "value"}';
      const result = noHighlight.process(json);
      expect(result.type).toBe(OutputType.JSON);
      // 禁用高亮时不应该有 ANSI 码
      expect(result.content).not.toContain('\x1b[');
    });

    it('禁用链接检测', () => {
      const noLinks = new OutputProcessor({ enableLinkDetection: false });
      const result = noLinks.process('Visit https://example.com');
      expect(result.content).not.toContain('\x1b[');
    });
  });

  describe('链接检测', () => {
    it('应该高亮 URL', () => {
      const result = processor.process('Visit https://example.com for info');
      expect(result.content).toContain('\x1b[');
    });
  });

  describe('set 方法', () => {
    it('应该动态调整折叠阈值', () => {
      processor.setFoldThreshold(10);
      const output = Array(20).fill('line').join('\n');
      const result = processor.process(output);
      expect(result.metadata?.isLong).toBe(true);
    });
  });
});

describe('outputProcessor 单例', () => {
  it('应该导出默认实例', () => {
    expect(outputProcessor).toBeInstanceOf(OutputProcessor);
  });
});
