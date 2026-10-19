export const PROXY_TYPES = ['SOCKS5', 'HTTP'] as const;

export type ProxyType = (typeof PROXY_TYPES)[number];

export const TARGET_PROXY_NAME_MAX_BYTES = 128;

export const TARGET_PROXY_HOST_MAX_BYTES = 512;

export const TARGET_PROXY_USERNAME_MAX_BYTES = 256;

export const TARGET_PROXY_PASSWORD_MAX_BYTES = 8192;
