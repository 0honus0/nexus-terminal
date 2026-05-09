/**
 * fileManagerTerminalPathUtils 单元测试
 */
import { describe, it, expect } from 'vitest';
import {
  isAbsolutePath,
  parsePathFromSilentOutput,
  SILENT_PWD_PREFIX,
} from './fileManagerTerminalPathUtils';

describe('isAbsolutePath', () => {
  it('Unix 绝对路径应返回 true', () => {
    expect(isAbsolutePath('/home/user')).toBe(true);
    expect(isAbsolutePath('/')).toBe(true);
    expect(isAbsolutePath('/tmp/test.txt')).toBe(true);
  });

  it('Windows 绝对路径应返回 true', () => {
    expect(isAbsolutePath('C:\\Users')).toBe(true);
    expect(isAbsolutePath('D:\\data')).toBe(true);
  });

  it('相对路径应返回 false', () => {
    expect(isAbsolutePath('home/user')).toBe(false);
    expect(isAbsolutePath('./test')).toBe(false);
    expect(isAbsolutePath('../parent')).toBe(false);
    expect(isAbsolutePath('file.txt')).toBe(false);
  });

  it('空字符串应返回 false', () => {
    expect(isAbsolutePath('')).toBe(false);
  });
});

describe('parsePathFromSilentOutput', () => {
  it('应解析带前缀的路径', () => {
    const output = `${SILENT_PWD_PREFIX}/home/user`;
    expect(parsePathFromSilentOutput(output)).toBe('/home/user');
  });

  it('应解析普通绝对路径', () => {
    expect(parsePathFromSilentOutput('/home/user')).toBe('/home/user');
  });

  it('应过滤 ANSI 转义序列', () => {
    const output = '\x1b[32m/home/user\x1b[0m';
    expect(parsePathFromSilentOutput(output)).toBe('/home/user');
  });

  it('空输出应返回 null', () => {
    expect(parsePathFromSilentOutput('')).toBeNull();
  });

  it('无有效路径应返回 null', () => {
    expect(parsePathFromSilentOutput('not a path')).toBeNull();
  });

  it('应处理多行输出', () => {
    const output = 'some noise\n/home/user\nmore noise';
    expect(parsePathFromSilentOutput(output)).toBe('/home/user');
  });

  it('应优先返回带前缀的路径', () => {
    const output = `noise\n${SILENT_PWD_PREFIX}/home/user`;
    expect(parsePathFromSilentOutput(output)).toBe('/home/user');
  });

  it('应处理 Windows 路径', () => {
    expect(parsePathFromSilentOutput('C:\\Users\\admin')).toBe('C:\\Users\\admin');
  });
});
