import type { Client } from 'ssh2';
import * as ConnectionRepository from '../connections/connection.repository';
import * as SshService from '../services/ssh.service';
import { StatusMonitorService, type ServerStatus } from '../services/status-monitor.service';

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

const CACHE_TTL_MS = 30_000;
const CONNECT_TIMEOUT_MS = 5_000;
const MAX_CONCURRENCY = 4;
const BOOTSTRAP_SAMPLE_DELAY_MS = 500;

const snapshotCollector = new StatusMonitorService(new Map());
const bootstrappedKeys = new Set<string>();
let cachedResult: { expiresAt: number; value: SshResourceStatus[] } | null = null;
let refreshInFlight: Promise<SshResourceStatus[]> | null = null;

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

async function refreshSshResourceStatuses(): Promise<SshResourceStatus[]> {
  const connections = (await ConnectionRepository.findAllConnectionsWithTags()).filter(
    (connection) => connection.type === 'SSH',
  );

  const grouped = new Map<string, ConnectionRepository.ConnectionWithTags[]>();
  for (const connection of connections) {
    const key = resourceKey(connection.host, connection.port);
    const existing = grouped.get(key);
    if (existing) existing.push(connection);
    else grouped.set(key, [connection]);
  }

  const entries = [...grouped.entries()];
  const statuses = await mapWithConcurrency(entries, MAX_CONCURRENCY, ([key, candidates]) =>
    collectForHost(key, candidates),
  );

  statuses.sort((a, b) => a.name.localeCompare(b.name) || a.host.localeCompare(b.host) || a.port - b.port);
  cachedResult = { expiresAt: Date.now() + CACHE_TTL_MS, value: statuses };
  return statuses;
}

export async function getSshResourceStatuses(): Promise<SshResourceStatus[]> {
  if (cachedResult && cachedResult.expiresAt > Date.now()) return cachedResult.value;
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = refreshSshResourceStatuses();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

export function clearSshResourceStatusCache(): void {
  cachedResult = null;
}
