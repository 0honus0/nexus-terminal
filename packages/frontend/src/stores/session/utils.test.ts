import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateSessionId, getLanguageFromFilename, decodeRawContent } from './utils';

vi.mock('@/utils/log', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('session/utils', () => {
  describe('generateSessionId', () => {
    it('应该返回字符串类型的 ID', () => {
      const id = generateSessionId();
      expect(typeof id).toBe('string');
    });

    it('每次调用应生成不同的 ID', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 50; i++) {
        ids.add(generateSessionId());
      }
      expect(ids.size).toBe(50);
    });

    it('生成的 ID 不应为空', () => {
      const id = generateSessionId();
      expect(id.length).toBeGreaterThan(0);
    });

    it('生成的 ID 应仅包含字母数字字符', () => {
      const id = generateSessionId();
      expect(id).toMatch(/^[a-z0-9]+$/);
    });
  });

  describe('getLanguageFromFilename', () => {
    it('应该识别 JavaScript 文件', () => {
      expect(getLanguageFromFilename('app.js')).toBe('javascript');
      expect(getLanguageFromFilename('utils.js')).toBe('javascript');
    });

    it('应该识别 TypeScript 文件', () => {
      expect(getLanguageFromFilename('index.ts')).toBe('typescript');
      expect(getLanguageFromFilename('types.ts')).toBe('typescript');
    });

    it('应该识别 JSON 文件', () => {
      expect(getLanguageFromFilename('package.json')).toBe('json');
    });

    it('应该识别 HTML 文件', () => {
      expect(getLanguageFromFilename('index.html')).toBe('html');
    });

    it('应该识别 CSS 文件', () => {
      expect(getLanguageFromFilename('style.css')).toBe('css');
    });

    it('应该识别 SCSS 文件', () => {
      expect(getLanguageFromFilename('theme.scss')).toBe('scss');
    });

    it('应该识别 LESS 文件', () => {
      expect(getLanguageFromFilename('theme.less')).toBe('less');
    });

    it('应该识别 Python 文件', () => {
      expect(getLanguageFromFilename('main.py')).toBe('python');
    });

    it('应该识别 Java 文件', () => {
      expect(getLanguageFromFilename('App.java')).toBe('java');
    });

    it('应该识别 C 文件', () => {
      expect(getLanguageFromFilename('main.c')).toBe('c');
    });

    it('应该识别 C++ 文件', () => {
      expect(getLanguageFromFilename('app.cpp')).toBe('cpp');
    });

    it('应该识别 C# 文件', () => {
      expect(getLanguageFromFilename('Program.cs')).toBe('csharp');
    });

    it('应该识别 Go 文件', () => {
      expect(getLanguageFromFilename('main.go')).toBe('go');
    });

    it('应该识别 PHP 文件', () => {
      expect(getLanguageFromFilename('index.php')).toBe('php');
    });

    it('应该识别 Ruby 文件', () => {
      expect(getLanguageFromFilename('app.rb')).toBe('ruby');
    });

    it('应该识别 Rust 文件', () => {
      expect(getLanguageFromFilename('lib.rs')).toBe('rust');
    });

    it('应该识别 SQL 文件', () => {
      expect(getLanguageFromFilename('query.sql')).toBe('sql');
    });

    it('应该识别 Shell 文件', () => {
      expect(getLanguageFromFilename('deploy.sh')).toBe('shell');
    });

    it('应该识别 YAML 文件 (.yaml)', () => {
      expect(getLanguageFromFilename('config.yaml')).toBe('yaml');
    });

    it('应该识别 YAML 文件 (.yml)', () => {
      expect(getLanguageFromFilename('config.yml')).toBe('yaml');
    });

    it('应该识别 Markdown 文件', () => {
      expect(getLanguageFromFilename('README.md')).toBe('markdown');
    });

    it('应该识别 XML 文件', () => {
      expect(getLanguageFromFilename('data.xml')).toBe('xml');
    });

    it('应该识别 INI 文件', () => {
      expect(getLanguageFromFilename('config.ini')).toBe('ini');
    });

    it('应该识别 BAT 文件', () => {
      expect(getLanguageFromFilename('run.bat')).toBe('bat');
    });

    it('应该识别 Dockerfile', () => {
      expect(getLanguageFromFilename('dockerfile')).toBe('dockerfile');
    });

    it('未知扩展名应返回 plaintext', () => {
      expect(getLanguageFromFilename('readme')).toBe('plaintext');
      expect(getLanguageFromFilename('Makefile')).toBe('plaintext');
    });

    it('扩展名应忽略大小写', () => {
      expect(getLanguageFromFilename('app.JS')).toBe('javascript');
      expect(getLanguageFromFilename('style.CSS')).toBe('css');
      expect(getLanguageFromFilename('index.HTML')).toBe('html');
      expect(getLanguageFromFilename('config.YAML')).toBe('yaml');
    });

    it('带路径的文件名应只取最后一部分', () => {
      expect(getLanguageFromFilename('/home/user/app.ts')).toBe('typescript');
      expect(getLanguageFromFilename('src/components/Button.vue')).toBe('plaintext');
    });
  });

  describe('decodeRawContent', () => {
    it('应该正确解码 UTF-8 编码的内容', () => {
      const original = 'Hello, 世界!';
      const base64 = Buffer.from(original, 'utf-8').toString('base64');
      expect(decodeRawContent(base64, 'utf-8')).toBe(original);
    });

    it('应该正确解码 UTF-16LE 编码的内容', () => {
      const original = 'Hello';
      const buffer = Buffer.from(original, 'utf16le');
      const base64 = buffer.toString('base64');
      expect(decodeRawContent(base64, 'utf-16le')).toBe(original);
    });

    it('应该正确解码 UTF-16BE 编码的内容（通过 iconv-lite）', () => {
      // Node.js Buffer 不直接支持 utf16be，但 iconv-lite 可以处理
      const original = 'Hello';
      // 手动创建 UTF-16BE 编码的 buffer
      const buffer = Buffer.alloc(original.length * 2);
      for (let i = 0; i < original.length; i++) {
        buffer[i * 2] = original.charCodeAt(i) >> 8;
        buffer[i * 2 + 1] = original.charCodeAt(i) & 0xff;
      }
      const base64 = buffer.toString('base64');
      expect(decodeRawContent(base64, 'utf-16be')).toBe(original);
    });

    it('编码名称标准化后应忽略非字母数字字符', () => {
      const original = 'Hello';
      const base64 = Buffer.from(original, 'utf-8').toString('base64');
      expect(decodeRawContent(base64, 'UTF-8')).toBe(original);
    });

    it('不支持的编码应回退到 UTF-8', () => {
      const original = 'Hello';
      const base64 = Buffer.from(original, 'utf-8').toString('base64');
      expect(decodeRawContent(base64, 'nonexistent-encoding')).toBe(original);
    });

    it('Buffer.from 对无效 Base64 不会抛出错误，但解码结果可能为乱码', () => {
      // Node.js 的 Buffer.from 对非标准 Base64 不会抛出异常，而是静默解码
      const result = decodeRawContent('not-valid-base64!!!', 'utf-8');
      expect(typeof result).toBe('string');
    });

    it('空字符串输入应返回空字符串', () => {
      const base64 = Buffer.from('', 'utf-8').toString('base64');
      expect(decodeRawContent(base64, 'utf-8')).toBe('');
    });
  });
});
