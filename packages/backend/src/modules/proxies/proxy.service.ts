export interface ProxySummary {
  id: number;
  name: string;
  type: 'SOCKS5' | 'HTTP';
  host: string;
  port: number;
}

export interface ProxyService {
  list(): Promise<ProxySummary[]>;
  get(id: number): Promise<ProxySummary | null>;
}
