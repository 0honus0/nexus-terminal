import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  ModelCapabilityRegistryFetchResult,
  ModelCapabilityRegistryPersistedState,
  ModelCapabilityRegistrySourcePort,
  ModelCapabilityRegistryStorePort,
} from '../../../modules/agent/ai/model-capability-registry.port';
import {
  MODEL_REGISTRY_MAX_RESPONSE_BYTES,
  MODEL_REGISTRY_SOURCE_URL,
  parseModelsDevRegistry,
  validateModelCapabilityRegistrySnapshot,
} from '../../../modules/agent/ai/model-capability-registry-source';
import { readBoundedResponse } from './bounded-response';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const unixSecondsOrNull = (value: unknown): number | null =>
  value === null || (Number.isSafeInteger(value) && Number(value) > 0) ? (value as number | null) : null;

const parsePersistedState = (raw: unknown): ModelCapabilityRegistryPersistedState => {
  if (!isRecord(raw) || raw.schemaVersion !== 1 || typeof raw.autoUpdate !== 'boolean') {
    throw new Error('MODEL_REGISTRY_CACHE_INVALID');
  }
  const snapshot = raw.snapshot === null ? null : validateModelCapabilityRegistrySnapshot(raw.snapshot);
  const lastErrorCode =
    raw.lastErrorCode === null
      ? null
      : typeof raw.lastErrorCode === 'string' && /^[A-Z][A-Z0-9_]{1,95}$/.test(raw.lastErrorCode)
        ? raw.lastErrorCode
        : null;
  return {
    schemaVersion: 1,
    autoUpdate: raw.autoUpdate,
    snapshot,
    lastAttemptAt: unixSecondsOrNull(raw.lastAttemptAt),
    lastSuccessAt: unixSecondsOrNull(raw.lastSuccessAt),
    lastErrorCode,
  };
};

export class LocalModelCapabilityRegistryStore implements ModelCapabilityRegistryStorePort {
  private readonly file: string;

  constructor(dataDirectory: string) {
    this.file = path.join(dataDirectory, 'agent', 'model-capability-registry.json');
  }

  async load(): Promise<ModelCapabilityRegistryPersistedState | null> {
    try {
      return parsePersistedState(JSON.parse(await readFile(this.file, 'utf8')) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async save(state: ModelCapabilityRegistryPersistedState): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp-${process.pid}-${randomUUID()}`;
    await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temp, this.file);
  }
}

export class ModelsDevCapabilityRegistrySource implements ModelCapabilityRegistrySourcePort {
  async fetch(sourceRevision: string | null): Promise<ModelCapabilityRegistryFetchResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('MODEL_REGISTRY_UPDATE_TIMEOUT')), 15_000);
    try {
      const response = await fetch(MODEL_REGISTRY_SOURCE_URL, {
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          'user-agent': 'nexus-terminal-model-registry-sync',
          ...(sourceRevision ? { 'if-none-match': sourceRevision } : {}),
        },
      });
      if (response.status === 304) {
        return { state: 'not-modified', sourceRevision: response.headers.get('etag') ?? sourceRevision };
      }
      if (!response.ok) throw new Error(`MODEL_REGISTRY_HTTP_${response.status}`);
      const bytes = await readBoundedResponse(
        response,
        MODEL_REGISTRY_MAX_RESPONSE_BYTES,
        'MODEL_REGISTRY_RESPONSE_TOO_LARGE',
      );
      let raw: unknown;
      try {
        raw = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
      } catch {
        throw new Error('MODEL_REGISTRY_RESPONSE_INVALID');
      }
      return {
        state: 'updated',
        snapshot: parseModelsDevRegistry(raw, {
          generatedAt: Math.floor(Date.now() / 1000),
          sourceRevision: response.headers.get('etag'),
        }),
      };
    } catch (error) {
      if (controller.signal.aborted) throw new Error('MODEL_REGISTRY_UPDATE_TIMEOUT');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
