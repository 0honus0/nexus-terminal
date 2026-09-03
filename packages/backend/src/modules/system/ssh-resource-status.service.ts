import type { ConnectionService } from '../connections/connection.service';
import type { SshConnectionResolver } from '../connections/services/ssh-connection-resolver.service';
import type { SettingsService } from '../settings/settings.service';
import type { ExecutionSessionManager } from '../../platform/execution/execution-session-manager';
import type { ServerStatus, ServerStatusCollector } from '../../platform/system/server-status.port';
export interface SshResourceStatus {
  key: string;
  connectionId: number;
  name: string;
  username: string;
  host: string;
  port: number;
  status?: ServerStatus;
  error?: string;
  checkedAt: number;
}
const keyFor = (host: string, port: number) => `${host.trim().toLowerCase()}:${port}`;
const RESOURCE_CONNECT_TIMEOUT_MS = 5_000;
export class SshResourceStatusService {
  private cache: { fingerprint: string; expiresAt: number; value: SshResourceStatus[] } | null = null;
  private inFlight: { fingerprint: string; promise: Promise<SshResourceStatus[]> } | null = null;
  constructor(
    private readonly connections: ConnectionService,
    private readonly resolver: SshConnectionResolver,
    private readonly sessions: ExecutionSessionManager,
    private readonly collector: ServerStatusCollector,
    private readonly settings: SettingsService,
  ) {}
  async getSshResourceStatuses() {
    const all = (await this.connections.list()).filter((c) => c.type === 'SSH');
    const refresh = await this.settings.getRemoteHostRefreshIntervalSeconds();
    const fingerprint = `${all.map((c) => [c.id, c.updatedAt, c.host, c.port, c.username, c.authMethod, c.proxyId, c.route, c.jumpChain?.join(',') ?? ''].join('\u001f')).join('\u001e')}\u001d${refresh}`;
    if (this.cache?.fingerprint === fingerprint && this.cache.expiresAt > Date.now()) return this.cache.value;
    if (this.inFlight?.fingerprint === fingerprint) return this.inFlight.promise;
    const groups = new Map<string, typeof all>();
    for (const c of all) {
      const key = keyFor(c.host, c.port);
      const arr = groups.get(key) ?? [];
      arr.push(c);
      groups.set(key, arr);
    }
    const collectionStartedAt = Date.now();
    const promise = this.collectGroups(groups);
    this.inFlight = { fingerprint, promise };
    try {
      const value = await promise;
      if (this.inFlight?.promise === promise)
        this.cache = {
          fingerprint,
          expiresAt: collectionStartedAt + Math.max(1000, refresh * 1000),
          value,
        };
      return value;
    } finally {
      if (this.inFlight?.promise === promise) this.inFlight = null;
    }
  }
  clearCache() {
    this.cache = null;
  }
  private async collectGroups(groups: Map<string, Awaited<ReturnType<ConnectionService['list']>>>) {
    const entries = [...groups.entries()];
    const results = new Array<SshResourceStatus>(entries.length);
    let next = 0;
    const worker = async () => {
      while (next < entries.length) {
        const index = next++;
        const entry = entries[index];
        if (entry) results[index] = await this.collectHost(entry[0], entry[1]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, entries.length) }, worker));
    return results.sort((a, b) => a.name.localeCompare(b.name) || a.host.localeCompare(b.host) || a.port - b.port);
  }
  private async collectHost(key: string, candidates: Awaited<ReturnType<ConnectionService['list']>>) {
    const representative = candidates[0]!;
    let lastError = 'Unable to collect SSH resource status.';
    for (const candidate of candidates) {
      let sessionId: string | undefined;
      try {
        const connection = await this.resolver.resolveStored(candidate.id);
        const session = await this.sessions.connect({
          ownerType: 'system',
          ownerId: `resource:${key}`,
          connection,
          connect: { timeoutMs: RESOURCE_CONNECT_TIMEOUT_MS },
        });
        sessionId = session.id;
        const status = await this.collector.collect(session, key);
        return {
          key,
          connectionId: candidate.id,
          name: candidate.name || candidate.host,
          username: candidate.username,
          host: candidate.host,
          port: candidate.port,
          status,
          checkedAt: Date.now(),
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      } finally {
        if (sessionId) await this.sessions.close(sessionId).catch(() => undefined);
      }
    }
    return {
      key,
      connectionId: representative.id,
      name: representative.name || representative.host,
      username: representative.username,
      host: representative.host,
      port: representative.port,
      error: lastError,
      checkedAt: Date.now(),
    };
  }
}
