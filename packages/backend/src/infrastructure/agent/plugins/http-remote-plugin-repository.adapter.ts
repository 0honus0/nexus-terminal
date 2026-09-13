import net from 'node:net';
import { Agent, fetch as undiciFetch, type Dispatcher } from 'undici';
import { compare, valid as validSemver } from 'semver';
import type { OutboundPolicyPort, ResolvedEndpoint } from '../../../modules/agent/ai/outbound-policy.port';
import type {
  RemotePluginCatalog,
  RemotePluginPackageEntry,
  RemotePluginPublisher,
  RemotePluginRepositoryConfig,
  RemotePluginRepositoryPort,
} from '../../../modules/agent/host/remote-plugin-repository.port';
import type { PluginPackageSource } from '../../../modules/agent/host/plugin-package-source.port';

const MAX_CATALOG_BYTES = 1024 * 1024;
const MAX_PACKAGE_BYTES = 50 * 1024 * 1024;
const APP_ID = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/;
const KEY_ID = /^ed25519:[a-f0-9]{64}$/;
const SHA256 = /^[a-f0-9]{64}$/;

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PLUGIN_REMOTE_CATALOG_INVALID');
  return value as Record<string, unknown>;
};
const text = (value: unknown, maxBytes: number): string => {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value.trim(), 'utf8') > maxBytes) {
    throw new Error('PLUGIN_REMOTE_CATALOG_INVALID');
  }
  return value.trim();
};
const integer = (value: unknown, max: number): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > max) {
    throw new Error('PLUGIN_REMOTE_CATALOG_INVALID');
  }
  return value as number;
};

const pinnedDispatcher = (endpoint: ResolvedEndpoint): { dispatcher: Agent; address: string } => {
  const address = endpoint.addresses[0];
  if (!address) throw new Error('PLUGIN_REMOTE_DNS_FAILED');
  const family = net.isIP(address);
  if (!family) throw new Error('PLUGIN_REMOTE_DNS_FAILED');
  const dispatcher = new Agent({
    connections: 1,
    pipelining: 1,
    connect: {
      servername: net.isIP(endpoint.hostname) === 0 ? endpoint.tlsServerName : undefined,
      lookup: (_hostname, options, callback) => {
        if (typeof options === 'object' && options.all) callback(null, [{ address, family }] as never);
        else callback(null, address, family);
      },
    },
  });
  return { dispatcher, address };
};

export class HttpRemotePluginRepositoryAdapter implements RemotePluginRepositoryPort {
  constructor(private readonly outbound: OutboundPolicyPort) {}

  async catalog(config: RemotePluginRepositoryConfig, signal?: AbortSignal): Promise<RemotePluginCatalog> {
    const bytes = await this.readBytes(config.url, config.privateHostExceptions, MAX_CATALOG_BYTES, signal);
    let raw: unknown;
    try {
      raw = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new Error('PLUGIN_REMOTE_CATALOG_INVALID');
    }
    return this.parseCatalog(raw, config.url);
  }

  async openPackage(
    config: RemotePluginRepositoryConfig,
    entry: RemotePluginPackageEntry,
    signal?: AbortSignal,
  ): Promise<PluginPackageSource> {
    if (!Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes < 1 || entry.sizeBytes > MAX_PACKAGE_BYTES) {
      throw new Error('PLUGIN_REMOTE_PACKAGE_INVALID');
    }
    const endpoint = await this.outbound.resolve(entry.packageUrl, config.privateHostExceptions);
    const { dispatcher } = pinnedDispatcher(endpoint);
    let response: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      response = await undiciFetch(endpoint.url, {
        method: 'GET',
        redirect: 'manual',
        dispatcher,
        signal,
        headers: { Accept: 'application/octet-stream', 'User-Agent': 'Nexus-Agent-Plugin-Repository/1' },
      });
    } catch (error) {
      await dispatcher.close().catch(() => undefined);
      throw error;
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined);
      await dispatcher.close().catch(() => undefined);
      throw new Error('PLUGIN_REMOTE_REDIRECT_DENIED');
    }
    if (response.status !== 200 || !response.body) {
      await response.body?.cancel().catch(() => undefined);
      await dispatcher.close().catch(() => undefined);
      throw new Error(`PLUGIN_REMOTE_HTTP_${response.status}`);
    }
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength !== entry.sizeBytes) {
      await response.body.cancel().catch(() => undefined);
      await dispatcher.close().catch(() => undefined);
      throw new Error('PLUGIN_REMOTE_SIZE_MISMATCH');
    }
    const body = response.body;
    const source = async function* (): AsyncIterable<Uint8Array> {
      let bytes = 0;
      try {
        for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
          bytes += chunk.byteLength;
          if (bytes > entry.sizeBytes || bytes > MAX_PACKAGE_BYTES) throw new Error('PLUGIN_REMOTE_PACKAGE_TOO_LARGE');
          yield chunk;
        }
        if (bytes !== entry.sizeBytes) throw new Error('PLUGIN_REMOTE_SIZE_MISMATCH');
      } finally {
        await dispatcher.close().catch(() => undefined);
      }
    };
    return { sizeBytes: entry.sizeBytes, source: source() };
  }

  private async readBytes(
    rawUrl: string,
    exceptions: readonly string[],
    maxBytes: number,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    const endpoint = await this.outbound.resolve(rawUrl, exceptions);
    const { dispatcher } = pinnedDispatcher(endpoint);
    try {
      const response = await undiciFetch(endpoint.url, {
        method: 'GET',
        redirect: 'manual',
        dispatcher: dispatcher as Dispatcher,
        signal,
        headers: { Accept: 'application/json', 'User-Agent': 'Nexus-Agent-Plugin-Repository/1' },
      });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error('PLUGIN_REMOTE_REDIRECT_DENIED');
      }
      if (response.status !== 200 || !response.body) throw new Error(`PLUGIN_REMOTE_HTTP_${response.status}`);
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > maxBytes) throw new Error('PLUGIN_REMOTE_CATALOG_TOO_LARGE');
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        bytes += chunk.byteLength;
        if (bytes > maxBytes) throw new Error('PLUGIN_REMOTE_CATALOG_TOO_LARGE');
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    } finally {
      await dispatcher.close().catch(() => undefined);
    }
  }

  private parseCatalog(raw: unknown, repositoryUrl: string): RemotePluginCatalog {
    const input = record(raw);
    if (input.schemaVersion !== 1 || !Array.isArray(input.publishers) || !Array.isArray(input.packages)) {
      throw new Error('PLUGIN_REMOTE_CATALOG_INVALID');
    }
    if (input.publishers.length > 64 || input.packages.length > 512) throw new Error('PLUGIN_REMOTE_CATALOG_INVALID');
    const publishers: RemotePluginPublisher[] = input.publishers.map((candidate) => {
      const value = record(candidate);
      const keyId = text(value.keyId, 128).toLowerCase();
      if (!KEY_ID.test(keyId)) throw new Error('PLUGIN_REMOTE_CATALOG_INVALID');
      return { keyId, label: text(value.label, 256), publicKeyPem: text(value.publicKeyPem, 8192) };
    });
    if (new Set(publishers.map((item) => item.keyId)).size !== publishers.length) {
      throw new Error('PLUGIN_REMOTE_CATALOG_INVALID');
    }
    const publisherIds = new Set(publishers.map((item) => item.keyId));
    const packages: RemotePluginPackageEntry[] = input.packages.map((candidate) => {
      const value = record(candidate);
      const appId = text(value.appId, 128);
      const version = text(value.version, 64);
      const sdkVersion = text(value.sdkVersion, 64);
      const nexus = record(value.nexus);
      const minVersion = text(nexus.minVersion, 64);
      const maxVersion = text(nexus.maxVersion, 64);
      const publisherKeyId = text(value.publisherKeyId, 128).toLowerCase();
      const sha256 = text(value.sha256, 64).toLowerCase();
      if (
        !APP_ID.test(appId) ||
        !validSemver(version) ||
        !validSemver(sdkVersion) ||
        !validSemver(minVersion) ||
        !validSemver(maxVersion) ||
        compare(minVersion, maxVersion) > 0 ||
        !KEY_ID.test(publisherKeyId) ||
        !publisherIds.has(publisherKeyId) ||
        !SHA256.test(sha256)
      ) {
        throw new Error('PLUGIN_REMOTE_CATALOG_INVALID');
      }
      let packageUrl: URL;
      try {
        packageUrl = new URL(text(value.packageUrl, 4096), repositoryUrl);
      } catch {
        throw new Error('PLUGIN_REMOTE_CATALOG_INVALID');
      }
      if (
        !['http:', 'https:'].includes(packageUrl.protocol) ||
        packageUrl.username ||
        packageUrl.password ||
        packageUrl.hash
      ) {
        throw new Error('PLUGIN_REMOTE_CATALOG_INVALID');
      }
      return {
        appId,
        version,
        sdkVersion,
        nexus: { minVersion, maxVersion },
        displayName: text(value.displayName, 256),
        description: text(value.description, 2048),
        packageUrl: packageUrl.toString(),
        sha256,
        sizeBytes: integer(value.sizeBytes, MAX_PACKAGE_BYTES),
        publisherKeyId,
      };
    });
    const identity = new Set(packages.map((item) => `${item.appId}@${item.version}`));
    if (identity.size !== packages.length) throw new Error('PLUGIN_REMOTE_CATALOG_INVALID');
    return { schemaVersion: 1, repositoryUrl: new URL(repositoryUrl).toString(), publishers, packages };
  }
}
