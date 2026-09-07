import ipaddr from 'ipaddr.js';
import type { SettingsService } from '../settings/settings.service';

const LOCAL = new Set(['127.0.0.1', '::1', 'localhost']);

export interface IpWhitelistDecision {
  allowed: boolean;
  statusCode: number;
  message: string;
}

const matchesEntry = (requestIp: ipaddr.IPv4 | ipaddr.IPv6, entry: string): boolean => {
  try {
    const [address, prefix] = ipaddr.parseCIDR(entry);
    let normalizedAddress: ipaddr.IPv4 | ipaddr.IPv6 = address;
    let normalizedPrefix = prefix;
    if (address.kind() === 'ipv6' && (address as ipaddr.IPv6).isIPv4MappedAddress()) {
      normalizedAddress = (address as ipaddr.IPv6).toIPv4Address();
      normalizedPrefix = Math.max(0, prefix - 96);
    }
    return requestIp.kind() === normalizedAddress.kind() && requestIp.match(normalizedAddress, normalizedPrefix);
  } catch {
    try {
      const allowed = ipaddr.process(entry);
      return requestIp.kind() === allowed.kind() && requestIp.toString() === allowed.toString();
    } catch {
      return false;
    }
  }
};

/** Shared application policy for HTTP and WebSocket source-address admission. */
export class IpWhitelistService {
  constructor(private readonly settings: SettingsService) {}

  async check(source: string | undefined): Promise<IpWhitelistDecision> {
    if (!source) return { allowed: false, statusCode: 403, message: '禁止访问：无法识别来源 IP。' };
    if (LOCAL.has(source)) return { allowed: true, statusCode: 200, message: '允许访问。' };
    try {
      const configured = await this.settings.getSetting('ipWhitelist');
      if (!configured?.trim()) return { allowed: true, statusCode: 200, message: '允许访问。' };
      const entries = configured
        .split(/[\n,]+/)
        .map((item) => item.trim())
        .filter(Boolean);
      if (!entries.length) return { allowed: false, statusCode: 403, message: '禁止访问：IP 白名单配置无效。' };
      let ip: ipaddr.IPv4 | ipaddr.IPv6;
      try {
        ip = ipaddr.process(source);
      } catch {
        return { allowed: false, statusCode: 403, message: '禁止访问：无效的来源 IP 格式。' };
      }
      return entries.some((entry) => matchesEntry(ip, entry))
        ? { allowed: true, statusCode: 200, message: '允许访问。' }
        : { allowed: false, statusCode: 403, message: '禁止访问：您的 IP 地址不在允许列表中。' };
    } catch {
      return { allowed: false, statusCode: 500, message: '服务器内部错误 (IP 校验失败)。' };
    }
  }
}
