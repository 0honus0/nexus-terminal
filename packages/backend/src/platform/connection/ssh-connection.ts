export type SshAuthMethod = 'password' | 'key';
export type SshRoute = 'proxy' | 'jump' | null;

export interface ResolvedSshProxy {
  type: 'SOCKS5' | 'HTTP';
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface ResolvedJumpHost {
  host: string;
  port: number;
  username: string;
  authMethod: SshAuthMethod;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

export interface ResolvedSshConnection {
  connectionId: number;
  displayName: string;
  host: string;
  port: number;
  username: string;
  authMethod: SshAuthMethod;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  route: SshRoute;
  proxy?: ResolvedSshProxy;
  jumpChain?: readonly ResolvedJumpHost[];
}

export interface SshConnectOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}
