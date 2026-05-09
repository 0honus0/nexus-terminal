/**
 * useAddConnectionFormParsers 单元测试
 * 测试 IP 范围解析和脚本行解析纯函数
 */
import { describe, it, expect } from 'vitest';
import { parseIpRange, parseScriptLine } from './useAddConnectionFormParsers';
import type { TranslateFn } from '../types/i18n.types';

// 模拟翻译函数，返回默认值
const t: TranslateFn = ((key: string, defaultValue?: string | Record<string, unknown>) => {
  if (typeof defaultValue === 'string') return defaultValue;
  if (typeof defaultValue === 'object') return JSON.stringify(defaultValue);
  return key;
}) as TranslateFn;

describe('parseIpRange', () => {
  it('应解析有效的 IP 范围', () => {
    const result = parseIpRange('192.168.1.1~192.168.1.5', t);

    expect(Array.isArray(result)).toBe(true);
    if (Array.isArray(result)) {
      expect(result).toHaveLength(5);
      expect(result[0]).toBe('192.168.1.1');
      expect(result[4]).toBe('192.168.1.5');
    }
  });

  it('应解析单个 IP 范围', () => {
    const result = parseIpRange('10.0.0.5~10.0.0.5', t);

    expect(Array.isArray(result)).toBe(true);
    if (Array.isArray(result)) {
      expect(result).toHaveLength(1);
      expect(result[0]).toBe('10.0.0.5');
    }
  });

  it('非范围字符串应返回错误', () => {
    const result = parseIpRange('192.168.1.1', t);

    expect(result).toHaveProperty('error');
  });

  it('格式错误应返回错误', () => {
    const result = parseIpRange('192.168.1.1~2~3', t);

    expect(result).toHaveProperty('error');
  });

  it('无效 IP 格式应返回错误', () => {
    const result = parseIpRange('invalid~192.168.1.5', t);

    expect(result).toHaveProperty('error');
  });

  it('不同子网应返回错误', () => {
    const result = parseIpRange('192.168.1.1~10.0.0.5', t);

    expect(result).toHaveProperty('error');
  });

  it('起始 IP 大于结束 IP 应返回错误', () => {
    const result = parseIpRange('192.168.1.10~192.168.1.5', t);

    expect(result).toHaveProperty('error');
  });

  it('应正确处理边界值 0 和 255', () => {
    const result = parseIpRange('192.168.1.254~192.168.1.255', t);

    expect(Array.isArray(result)).toBe(true);
    if (Array.isArray(result)) {
      expect(result).toHaveLength(2);
    }
  });
});

describe('parseScriptLine', () => {
  it('应解析基本 SSH 连接', () => {
    const result = parseScriptLine('root@192.168.1.1 -p mypassword', t);

    expect(result.type).toBe('SSH');
    expect(result.userHostPort).toBe('root@192.168.1.1');
    expect(result.password).toBe('mypassword');
    expect(result.error).toBeUndefined();
  });

  it('应解析带端口的 SSH 连接', () => {
    const result = parseScriptLine('admin@10.0.0.1:2222 -p pass123', t);

    expect(result.userHostPort).toBe('admin@10.0.0.1:2222');
    expect(result.password).toBe('pass123');
  });

  it('应解析使用密钥的 SSH 连接', () => {
    const result = parseScriptLine('user@host -k mykey', t);

    expect(result.keyName).toBe('mykey');
    expect(result.password).toBeNull();
  });

  it('应解析自定义名称', () => {
    const result = parseScriptLine('root@host -p pass -name MyServer', t);

    expect(result.name).toBe('MyServer');
  });

  it('应解析连接类型', () => {
    const result = parseScriptLine('admin@host -p pass -type RDP', t);

    expect(result.type).toBe('RDP');
  });

  it('应解析代理名称', () => {
    const result = parseScriptLine('root@host -p pass -proxy MyProxy', t);

    expect(result.proxyName).toBe('MyProxy');
  });

  it('应解析标签', () => {
    const result = parseScriptLine('root@host -p pass -tags web prod', t);

    expect(result.tags).toEqual(['web', 'prod']);
  });

  it('应解析备注', () => {
    const result = parseScriptLine('root@host -p pass -note This is a server', t);

    expect(result.note).toBe('This is a server');
  });

  it('空行应返回错误', () => {
    const result = parseScriptLine('', t);

    expect(result.error).toBeDefined();
  });

  it('无效格式应返回错误', () => {
    const result = parseScriptLine('invalid-format', t);

    expect(result.error).toBeDefined();
  });

  it('SSH 无认证应返回错误', () => {
    const result = parseScriptLine('root@host', t);

    expect(result.error).toBeDefined();
  });

  it('RDP 无密码应返回错误', () => {
    const result = parseScriptLine('admin@host -type RDP', t);

    expect(result.error).toBeDefined();
  });

  it('VNC 无密码应返回错误', () => {
    const result = parseScriptLine('admin@host -type VNC', t);

    expect(result.error).toBeDefined();
  });

  it('应使用默认名称 user@host', () => {
    const result = parseScriptLine('testuser@testhost -p pass', t);

    expect(result.name).toBe('testuser@testhost');
  });

  it('应支持带引号的值', () => {
    const result = parseScriptLine('root@host -p "my password" -name "My Server"', t);

    expect(result.password).toBe('my password');
    expect(result.name).toBe('My Server');
  });
});
