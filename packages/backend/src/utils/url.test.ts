import { describe, expect, it } from 'vitest';
import {
  getHostnameFromHostHeader,
  getHostnameFromOrigin,
  getSingleHeaderToken,
  normalizeOrigin,
} from './url';

describe('url utils', () => {
  describe('getSingleHeaderToken', () => {
    it('应返回逗号分隔头部的第一个有效值', () => {
      expect(getSingleHeaderToken('https://a.example.com, https://b.example.com')).toBe(
        'https://a.example.com'
      );
    });

    it('空值应返回 undefined', () => {
      expect(getSingleHeaderToken(undefined)).toBeUndefined();
      expect(getSingleHeaderToken('')).toBeUndefined();
    });
  });

  describe('normalizeOrigin', () => {
    it('应归一化 origin', () => {
      expect(normalizeOrigin('https://Example.COM:443/path')).toBe('https://example.com');
    });

    it('无效 origin 应返回 undefined', () => {
      expect(normalizeOrigin('invalid-origin')).toBeUndefined();
    });
  });

  describe('getHostnameFromOrigin', () => {
    it('应解析并标准化主机名', () => {
      expect(getHostnameFromOrigin('https://Sub.Example.com/path')).toBe('sub.example.com');
    });

    it('应正确处理 IPv6 origin', () => {
      expect(getHostnameFromOrigin('http://[::1]:3001')).toBe('::1');
    });
  });

  describe('getHostnameFromHostHeader', () => {
    it('应从 host:port 中提取主机名', () => {
      expect(getHostnameFromHostHeader('example.com:3001')).toBe('example.com');
    });

    it('应正确解析 IPv6 host header', () => {
      expect(getHostnameFromHostHeader('[::1]:3001')).toBe('::1');
    });

    it('无效 host header 应返回 undefined', () => {
      expect(getHostnameFromHostHeader(':::')).toBeUndefined();
    });
  });
});
