import { Request, Response, NextFunction } from 'express';
import ipaddr from 'ipaddr.js';
import { settingsService } from '../settings/settings.service';

const IP_WHITELIST_SETTING_KEY = 'ipWhitelist';

// 本地开发环境的 IP 地址列表
const LOCAL_IPS = [
  '127.0.0.1', // IPv4 本地回环
  '::1', // IPv6 本地回环
  'localhost', // 本地主机名
];

export interface IpWhitelistDecision {
  allowed: boolean;
  statusCode: number;
  message: string;
}

export const checkIpWhitelist = async (requestIpString: string): Promise<IpWhitelistDecision> => {
  if (LOCAL_IPS.includes(requestIpString)) {
    return { allowed: true, statusCode: 200, message: '允许访问。' };
  }

  try {
    const whitelistString = await settingsService.getSetting(IP_WHITELIST_SETTING_KEY);
    if (!whitelistString || whitelistString.trim() === '') {
      return { allowed: true, statusCode: 200, message: '允许访问。' };
    }

    const whitelistEntries = whitelistString
      .split(/[\n,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);

    if (whitelistEntries.length === 0) {
      return { allowed: false, statusCode: 403, message: '禁止访问：IP 白名单配置无效。' };
    }

    let requestIp: ipaddr.IPv4 | ipaddr.IPv6;
    try {
      requestIp = ipaddr.process(requestIpString);
    } catch {
      return { allowed: false, statusCode: 403, message: '禁止访问：无效的来源 IP 格式。' };
    }

    const isAllowed = whitelistEntries.some((entry) => {
      try {
        const [rangeAddress, prefixLength] = ipaddr.parseCIDR(entry);
        let normalizedRangeAddress: ipaddr.IPv4 | ipaddr.IPv6 = rangeAddress;
        let normalizedPrefixLength = prefixLength;
        if (rangeAddress.kind() === 'ipv6') {
          const ipv6RangeAddress = rangeAddress as ipaddr.IPv6;
          if (ipv6RangeAddress.isIPv4MappedAddress()) {
            normalizedRangeAddress = ipv6RangeAddress.toIPv4Address();
            normalizedPrefixLength = Math.max(0, prefixLength - 96);
          }
        }
        if (requestIp.kind() !== normalizedRangeAddress.kind()) return false;
        return requestIp.match(normalizedRangeAddress, normalizedPrefixLength);
      } catch {
        try {
          const allowedIp = ipaddr.process(entry);
          return requestIp.kind() === allowedIp.kind() && requestIp.toString() === allowedIp.toString();
        } catch {
          console.warn(`无效的 IP 白名单条目: "${entry}"`);
          return false;
        }
      }
    });

    return isAllowed
      ? { allowed: true, statusCode: 200, message: '允许访问。' }
      : { allowed: false, statusCode: 403, message: '禁止访问：您的 IP 地址不在允许列表中。' };
  } catch (error) {
    console.error('IP 白名单检查出错:', error);
    return { allowed: false, statusCode: 500, message: '服务器内部错误 (IP 校验失败)。' };
  }
};

/**
 * IP 白名单中间件
 * 检查请求来源 IP 是否在设置中定义的白名单内。
 * 白名单支持 IPv4, IPv6 地址以及 CIDR 范围。
 * 如果白名单未设置或为空，则允许所有 IP。
 * 本地开发环境的 IP 地址始终允许访问。
 */
export const ipWhitelistMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const requestIpString = req.ip || req.socket.remoteAddress;
  if (!requestIpString) {
    return res.status(403).json({ message: '禁止访问：无法识别来源 IP。' });
  }

  const decision = await checkIpWhitelist(requestIpString);
  if (decision.allowed) return next();
  return res.status(decision.statusCode).json({ message: decision.message });
};
