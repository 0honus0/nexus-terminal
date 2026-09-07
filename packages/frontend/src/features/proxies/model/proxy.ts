export type ProxyType = 'SOCKS5' | 'HTTP';
export type ProxyAuthMethod = 'none' | 'password' | 'key';
export interface Proxy {
  id: number;
  name: string;
  type: ProxyType;
  host: string;
  port: number;
  username: string | null;
  authMethod: ProxyAuthMethod;
  createdAt: number;
  updatedAt: number;
}
export interface ProxyInput {
  name: string;
  type: ProxyType;
  host: string;
  port: number;
  username?: string | null;
  authMethod?: ProxyAuthMethod;
  password?: string | null;
  privateKey?: string | null;
  passphrase?: string | null;
}
