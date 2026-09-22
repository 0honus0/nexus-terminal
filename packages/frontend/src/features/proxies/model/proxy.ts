import type {
  ProxyAuthMethodDto,
  ProxyCreateRequestDto,
  ProxyDto,
  ProxyTypeDto,
} from '@nexus-terminal/protocol/connections';

export type ProxyType = ProxyTypeDto;
export type ProxyAuthMethod = ProxyAuthMethodDto;
export type Proxy = ProxyDto;
export type ProxyInput = ProxyCreateRequestDto;
