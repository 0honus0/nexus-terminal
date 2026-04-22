import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as jschardet from 'jschardet';
import { detectAndDecodeSftpFileContent } from './sftp-encoding.utils';

vi.mock('jschardet', () => ({
  detect: vi.fn(),
}));

describe('sftp-encoding.utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('应在指定有效编码时使用规范化后的编码名称', () => {
    const result = detectAndDecodeSftpFileContent({
      fileData: Buffer.from('hello', 'utf8'),
      requestedEncoding: 'UTF-8',
      sessionId: 's1',
      remotePath: '/tmp/a.txt',
      requestId: 'r1',
    });

    expect(result.encodingUsed).toBe('utf8');
    expect(result.decodedContent).toBe('hello');
  });

  it('应在指定无效编码时回退到 utf-8', () => {
    const result = detectAndDecodeSftpFileContent({
      fileData: Buffer.from('hello', 'utf8'),
      requestedEncoding: 'not-a-real-encoding',
      sessionId: 's1',
      remotePath: '/tmp/a.txt',
      requestId: 'r2',
    });

    expect(result.encodingUsed).toBe('utf-8');
    expect(result.decodedContent).toBe('hello');
  });

  it('应在自动检测为高置信 UTF-8 时返回 utf-8', () => {
    vi.mocked(jschardet.detect).mockReturnValue({
      encoding: 'UTF-8',
      confidence: 0.99,
    });

    const result = detectAndDecodeSftpFileContent({
      fileData: Buffer.from('hello', 'utf8'),
      sessionId: 's2',
      remotePath: '/tmp/b.txt',
      requestId: 'r3',
    });

    expect(result.encodingUsed).toBe('utf-8');
    expect(result.decodedContent).toBe('hello');
  });

  it('应在自动检测为高置信未知编码时回退到 utf-8', () => {
    vi.mocked(jschardet.detect).mockReturnValue({
      encoding: 'X-UNKNOWN-ENCODING',
      confidence: 0.95,
    });

    const result = detectAndDecodeSftpFileContent({
      fileData: Buffer.from('hello', 'utf8'),
      sessionId: 's3',
      remotePath: '/tmp/c.txt',
      requestId: 'r4',
    });

    expect(result.encodingUsed).toBe('utf-8');
    expect(result.decodedContent).toBe('hello');
  });
});
