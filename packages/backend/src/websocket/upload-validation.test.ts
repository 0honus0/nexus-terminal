import { describe, expect, it } from 'vitest';
import { validateWebSocketMessage } from './validate';

describe('WebSocket 上传消息校验兼容性', () => {
  it('应接受当前 sftp:upload:start 协议', () => {
    const result = validateWebSocketMessage({
      type: 'sftp:upload:start',
      payload: {
        uploadId: 'upload-1',
        remotePath: '/root/.env',
        size: 128,
        relativePath: '.',
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payload).toMatchObject({
        uploadId: 'upload-1',
        remotePath: '/root/.env',
        size: 128,
        relativePath: '.',
      });
    }
  });

  it('应兼容旧版 sftp:upload:start 协议并转换为当前字段', () => {
    const result = validateWebSocketMessage({
      type: 'sftp:upload:start',
      payload: {
        uploadId: 'upload-legacy',
        fileName: 'a.txt',
        fileSize: 256,
        targetPath: '/root/a.txt',
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payload).toMatchObject({
        uploadId: 'upload-legacy',
        remotePath: '/root/a.txt',
        size: 256,
      });
    }
  });

  it('应拒绝缺少 size/fileSize 的上传开始消息', () => {
    const result = validateWebSocketMessage({
      type: 'sftp:upload:start',
      payload: {
        uploadId: 'upload-invalid',
        remotePath: '/root/a.txt',
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('消息校验失败 (sftp:upload:start)');
    }
  });

  it('应接受当前 sftp:upload:chunk 协议', () => {
    const result = validateWebSocketMessage({
      type: 'sftp:upload:chunk',
      payload: {
        uploadId: 'upload-1',
        chunkIndex: 0,
        data: 'dGVzdA==',
        isLast: false,
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payload).toMatchObject({
        uploadId: 'upload-1',
        chunkIndex: 0,
        data: 'dGVzdA==',
      });
    }
  });

  it('应兼容旧版 sftp:upload:chunk 协议并转换为 data 字段', () => {
    const result = validateWebSocketMessage({
      type: 'sftp:upload:chunk',
      payload: {
        uploadId: 'upload-legacy',
        chunkIndex: 1,
        chunk: 'Yg==',
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payload).toMatchObject({
        uploadId: 'upload-legacy',
        chunkIndex: 1,
        data: 'Yg==',
      });
    }
  });

  it('应允许零字节文件上传块 data 为空字符串', () => {
    const result = validateWebSocketMessage({
      type: 'sftp:upload:chunk',
      payload: {
        uploadId: 'upload-zero-byte',
        chunkIndex: 0,
        data: '',
        isLast: true,
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payload).toMatchObject({
        uploadId: 'upload-zero-byte',
        chunkIndex: 0,
        data: '',
        isLast: true,
      });
    }
  });
});
