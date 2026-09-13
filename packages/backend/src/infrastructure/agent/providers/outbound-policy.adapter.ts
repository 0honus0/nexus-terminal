import { promises as dns } from 'node:dns';
import net from 'node:net';
import ipaddr from 'ipaddr.js';
import type { OutboundPolicyPort, ResolvedEndpoint } from '../../../modules/agent/ai/outbound-policy.port';

const METADATA_ADDRESSES = new Set(['169.254.169.254', '100.100.100.200', 'fd00:ec2::254']);
const PRIVATE_RANGES = new Set(['private', 'loopback', 'uniqueLocal']);

const bareHostname = (hostname: string): string => hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();

const authorityFor = (hostname: string, port: number): string => {
  const bare = bareHostname(hostname);
  return `${net.isIP(bare) === 6 ? `[${bare}]` : bare}:${port}`;
};

const addressRange = (address: string): string => {
  const parsed = ipaddr.process(address);
  return parsed.range();
};

const isAlwaysDenied = (address: string): boolean => {
  const normalized = ipaddr.process(address).toString().toLowerCase();
  if (METADATA_ADDRESSES.has(normalized)) return true;
  const range = addressRange(address);
  return !PRIVATE_RANGES.has(range) && range !== 'unicast';
};

const isPrivate = (address: string): boolean => PRIVATE_RANGES.has(addressRange(address));
const isLoopback = (address: string): boolean => addressRange(address) === 'loopback';

export class OutboundPolicyAdapter implements OutboundPolicyPort {
  constructor(
    private readonly nodeEnv: string,
    private readonly allowInsecurePrivateHostExceptions = false,
  ) {}

  async resolve(rawUrl: string, privateHostExceptions: readonly string[]): Promise<ResolvedEndpoint> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new Error('PROVIDER_ENDPOINT_INVALID');
    }
    if (url.username || url.password) throw new Error('PROVIDER_ENDPOINT_INVALID');
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('PROVIDER_ENDPOINT_SCHEME_DENIED');

    const hostname = bareHostname(url.hostname);
    const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PROVIDER_ENDPOINT_INVALID');
    const authority = authorityFor(hostname, port);
    const exceptionAllowed = privateHostExceptions.some((value) => value.trim().toLowerCase() === authority);

    const addresses = await this.resolveAddresses(hostname);
    if (addresses.length === 0) throw new Error('PROVIDER_DNS_RESOLUTION_FAILED');

    for (const address of addresses) {
      if (isAlwaysDenied(address)) throw new Error('PROVIDER_ENDPOINT_DENIED');
      if (isPrivate(address) && !exceptionAllowed) throw new Error('PROVIDER_PRIVATE_ENDPOINT_DENIED');
    }

    if (url.protocol === 'http:') {
      const explicitDevelopmentLoopback =
        this.nodeEnv !== 'production' && exceptionAllowed && addresses.every((address) => isLoopback(address));
      const explicitE2ePrivateException =
        this.allowInsecurePrivateHostExceptions && exceptionAllowed && addresses.every((address) => isPrivate(address));
      if (!explicitDevelopmentLoopback && !explicitE2ePrivateException) {
        throw new Error('PROVIDER_INSECURE_ENDPOINT_DENIED');
      }
    }

    return {
      url: url.toString(),
      protocol: url.protocol,
      hostname,
      port,
      authority,
      addresses,
      tlsServerName: hostname,
    };
  }

  private async resolveAddresses(hostname: string): Promise<string[]> {
    if (net.isIP(hostname)) return [hostname];
    let results: Array<{ address: string }>;
    try {
      results = await dns.lookup(hostname, { all: true, verbatim: true });
    } catch {
      throw new Error('PROVIDER_DNS_RESOLUTION_FAILED');
    }
    return [...new Set(results.map((entry) => entry.address))];
  }
}
