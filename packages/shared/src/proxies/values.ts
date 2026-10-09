export const PROXY_TYPES = ['SOCKS5', 'HTTP'] as const;
export type ProxyType = (typeof PROXY_TYPES)[number];
