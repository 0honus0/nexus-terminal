import type { Client } from 'ssh2';
import * as ConnectionRepository from '../connections/connection.repository';
import * as SshService from '../services/ssh.service';
import { StatusMonitorService, type ServerStatus } from '../services/status-monitor.service';
import { settingsService } from '../settings/settings.service';

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

const DEFAULT_REMOTE_HOST_REFRESH_TTL_MS = 30_000;
const CONNECT_TIMEOUT_MS = 5_000;
const MAX_CONCURRENCY = 4;
const BOOTSTRAP_SAMPLE_DELAY_MS = 500;

const snapshotCollector = new StatusMonitorService(new Map());
const bootstrappedKeys = new Set<string>();
let cachedResult: { fingerprint: string; expiresAt: number; value: SshResourceStatus[] } | null = null;
let refreshInFlight: { fingerprint: string; promise: Promise<SshResourceStatus[]> } | null = null;

const normalizeHost = (host: string): string => host.trim().toLowerCase();
const resourceKey = (host: string, port: number): string => `${normalizeHost(host)}:${port}`;
const wait = (delayMs: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, delayMs));

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      results[index] = await mapper(values[index]);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

async function collectForHost(
  key: string,
  candidates: ConnectionRepository.ConnectionWithTags[],
): Promise<SshResourceStatus> {
  const representative = candidates[0];
  let lastError = 'Unable to collect SSH resource status.';

  for (const candidate of candidates) {
    let client: Client | null = null;
    try {
      const details = await SshService.getConnectionDetails(candidate.id);
      client = await SshService.establishSshConnection(details, CONNECT_TIMEOUT_MS);

      let status = await snapshotCollector.collectServerStatus(client, key);
      if (!bootstrappedKeys.has(key)) {
        // The first CPU sample only establishes a baseline. Take one extra sample
        // on first discovery; later 30-second refreshes only execute once.
        await wait(BOOTSTRAP_SAMPLE_DELAY_MS);
        status = await snapshotCollector.collectServerStatus(client, key);
        bootstrappedKeys.add(key);
      }

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
      client?.end();
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

function buildConnectionFingerprint(connections: ConnectionRepository.ConnectionWithTags[]): string {
  return [...connections]
    .sort((a, b) => a.id - b.id)
    .map((connection) => [
      connection.id,
      connection.updated_at,
      connection.name ?? '',
      normalizeHost(connection.host),
      connection.port,
      connection.username,
      connection.auth_method,
      connection.proxy_id ?? '',
      connection.proxy_type ?? '',
      connection.ssh_key_id ?? '',
      connection.jump_chain?.join(',') ?? '',
    ].join('\u001f'))
    .join('\u001e');
}

function groupSshConnections(
  connections: ConnectionRepository.ConnectionWithTags[],
): Map<string, ConnectionRepository.ConnectionWithTags[]> {
  const grouped = new Map<string, ConnectionRepository.ConnectionWithTags[]>();
  for (const connection of connections) {
    const key = resourceKey(connection.host, connection.port);
    const existing = grouped.get(key);
    if (existing) existing.push(connection);
    else grouped.set(key, [connection]);
  }
  return grouped;
}

async function refreshSshResourceStatuses(
  grouped: Map<string, ConnectionRepository.ConnectionWithTags[]>,
): Promise<SshResourceStatus[]> {
  const statuses = await mapWithConcurrency([...grouped.entries()], MAX_CONCURRENCY, ([key, candidates]) =>
    collectForHost(key, candidates),
  );

  statuses.sort((a, b) => a.name.localeCompare(b.name) || a.host.localeCompare(b.host) || a.port - b.port);
  return statuses;
}

export async function getSshResourceStatuses(): Promise<SshResourceStatus[]> {
  // Keep SSH probing low-frequency, but always compare the inexpensive connection
  // metadata first. A full-result TTL alone can otherwise hide newly created or
  // edited hosts until the next 30-second poll.
  const connections = (await ConnectionRepository.findAllConnectionsWithTags()).filter(
    (connection) => connection.type === 'SSH',
  );
  const connectionFingerprint = buildConnectionFingerprint(connections);
  const refreshSeconds = await settingsService.getRemoteHostRefreshIntervalSeconds();
  const cacheTtlMs = Math.max(1000, refreshSeconds * 1000) || DEFAULT_REMOTE_HOST_REFRESH_TTL_MS;
  // Include the interval itself in the cache identity so a settings change takes
  // effect immediately instead of waiting for a snapshot created with the old TTL.
  const fingerprint = `${connectionFingerprint}\u001d${refreshSeconds}`;

  if (cachedResult && cachedResult.fingerprint === fingerprint && cachedResult.expiresAt > Date.now()) {
    return cachedResult.value;
  }
  if (refreshInFlight?.fingerprint === fingerprint) return refreshInFlight.promise;

  const grouped = groupSshConnections(connections);
  const promise = refreshSshResourceStatuses(grouped);
  const currentRefresh = { fingerprint, promise };
  refreshInFlight = currentRefresh;

  try {
    const statuses = await promise;
    // A newer configuration may have started refreshing while this request was
    // still running. Do not let the older result overwrite that newer cache.
    if (refreshInFlight === currentRefresh) {
      cachedResult = { fingerprint, expiresAt: Date.now() + cacheTtlMs, value: statuses };
    }
    return statuses;
  } finally {
    if (refreshInFlight === currentRefresh) refreshInFlight = null;
  }
}

export function clearSshResourceStatusCache(): void {
  cachedResult = null;
}
