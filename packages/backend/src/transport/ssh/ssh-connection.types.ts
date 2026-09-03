export type SshAuthMethod = 'password' | 'key';

export interface ResolvedSshProxy {
  id: number;
  name: string;
  type: 'SOCKS5' | 'HTTP';
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface ResolvedJumpHost {
  id: string;
  name?: string;
  host: string;
  port: number;
  username: string;
  authMethod: SshAuthMethod;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

export interface ResolvedSshConnection {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: SshAuthMethod;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  proxy?: ResolvedSshProxy | null;
  jumpChain?: ResolvedJumpHost[];
  route: 'proxy' | 'jump' | null;
}

export interface UnsavedSshConnectionInput {
  host: string;
  port: number;
  username: string;
  auth_method: SshAuthMethod;
  password?: string;
  private_key?: string;
  passphrase?: string;
  ssh_key_id?: number | null;
  proxy_id?: number | null;
}
