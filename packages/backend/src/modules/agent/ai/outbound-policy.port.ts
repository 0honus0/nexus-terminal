export interface ResolvedEndpoint {
  url: string;
  protocol: 'http:' | 'https:';
  hostname: string;
  port: number;
  authority: string;
  addresses: string[];
  tlsServerName: string;
}

export interface OutboundPolicyPort {
  resolve(url: string, privateHostExceptions: readonly string[]): Promise<ResolvedEndpoint>;
}
