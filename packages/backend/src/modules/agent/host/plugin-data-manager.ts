import { logger } from '../../../shared/logging/logger';
import type { JsonValue, Scope } from '../agent.types';
import { requireIdempotencyKey } from '../runtime/runs/idempotency';
import type { AppStateRepositoryPort } from './app-state.repository.port';
import type { AppStoragePort, AppStorageRecord } from './app-storage.port';
import type { AppStorageSnapshot, AppStorageSnapshotPort } from './app-storage-snapshot.port';
import type { AppIntentService } from './app-intent.service';
import type { PluginInstallRepositoryPort } from './plugin-install.repository.port';
import type { PluginFrontendRpcRequest, PluginInstallationView } from './plugin-install.types';

const MAX_FRONTEND_RPC_BYTES = 64_000;
const FRONTEND_MUTATION_METHODS = new Set(['storage.put', 'storage.delete', 'intents.create', 'intents.revoke']);

const asRecord = (value: JsonValue, code = 'PLUGIN_FRONTEND_RPC_INVALID'): Record<string, JsonValue> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
  return value as Record<string, JsonValue>;
};

const requireOnlyKeys = (value: Record<string, JsonValue>, allowed: readonly string[]): void => {
  const set = new Set(allowed);
  if (Object.keys(value).some((key) => !set.has(key))) throw new Error('PLUGIN_FRONTEND_RPC_INVALID');
};

const requireStorageKey = (value: JsonValue | undefined): string => {
  if (typeof value !== 'string' || value.length < 1 || Buffer.byteLength(value, 'utf8') > 256) {
    throw new Error('PLUGIN_FRONTEND_RPC_INVALID');
  }
  return value;
};

const requireRpcString = (value: JsonValue | undefined, maxBytes = 256): string => {
  if (typeof value !== 'string' || value.length < 1 || Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new Error('PLUGIN_FRONTEND_RPC_INVALID');
  }
  return value;
};

const requireIntentArtifactRefs = (value: JsonValue | undefined): Array<{ appId: string; id: string }> => {
  if (!Array.isArray(value) || value.length > 16) throw new Error('PLUGIN_FRONTEND_RPC_INVALID');
  return value.map((candidate) => {
    const record = asRecord(candidate);
    requireOnlyKeys(record, ['appId', 'id']);
    return { appId: requireRpcString(record.appId), id: requireRpcString(record.id) };
  });
};

const storageRecordJson = (record: AppStorageRecord | null): JsonValue =>
  record
    ? {
        key: record.key,
        value: record.value,
        bytes: record.bytes,
        version: record.version,
        updatedAt: record.updatedAt,
      }
    : null;

export class PluginDataManager {
  constructor(
    private readonly repository: PluginInstallRepositoryPort,
    private readonly states: AppStateRepositoryPort,
    private readonly storage: AppStoragePort & AppStorageSnapshotPort,
    private readonly appIntents: AppIntentService,
  ) {}

  capture(scope: Scope): Promise<AppStorageSnapshot> {
    return this.storage.capture(scope);
  }

  restore(scope: Scope, snapshot: AppStorageSnapshot): Promise<void> {
    return this.storage.restore(scope, snapshot);
  }

  async deleteData(userId: number, appId: string): Promise<void> {
    const installation = await this.repository.getInstallation(userId, appId);
    if (!installation || installation.status !== 'removed') throw new Error('PLUGIN_MUST_BE_UNINSTALLED');
    await this.storage.clear({ userId, appId });
    logger.info({ userId, appId }, 'Agent plugin retained data deleted');
  }

  async listInstallations(userId: number): Promise<PluginInstallationView[]> {
    const installations = await this.repository.listInstallations(userId);
    return Promise.all(
      installations.map(async (installation) => {
        if (installation.status !== 'removed') {
          return { ...installation, retainedDataEntries: 0, retainedDataBytes: 0 };
        }
        const stats = await this.storage.stats({ userId, appId: installation.appId });
        return {
          ...installation,
          retainedDataEntries: stats.entryCount,
          retainedDataBytes: stats.totalBytes,
        };
      }),
    );
  }

  async frontendRpc(userId: number, appId: string, request: PluginFrontendRpcRequest): Promise<JsonValue> {
    const encoded = JSON.stringify(request);
    if (Buffer.byteLength(encoded, 'utf8') > MAX_FRONTEND_RPC_BYTES) throw new Error('PLUGIN_FRONTEND_RPC_TOO_LARGE');
    const installation = await this.repository.getInstallation(userId, appId);
    if (!installation || installation.status !== 'installed') throw new Error('PLUGIN_NOT_INSTALLED');
    if (request.version !== installation.version) throw new Error('PLUGIN_FRONTEND_VERSION_STALE');
    const scope = { userId, appId };
    const operationId = request.operationId === undefined ? undefined : requireIdempotencyKey(request.operationId);
    if (FRONTEND_MUTATION_METHODS.has(request.method) && !operationId) throw new Error('IDEMPOTENCY_KEY_INVALID');
    const state = await this.states.get(scope);
    if (!state) throw new Error('AGENT_APP_DISABLED');
    if (state.activeVersion !== request.version) throw new Error('PLUGIN_FRONTEND_VERSION_STALE');
    if (state.desiredState !== 'enabled' || !['running', 'degraded'].includes(state.observedState)) {
      throw new Error('AGENT_APP_DISABLED');
    }
    const plugin = await this.repository.getVersion(appId, installation.version);
    if (!plugin || plugin.status !== 'installed') throw new Error('PLUGIN_VERSION_NOT_FOUND');

    switch (request.method) {
      case 'host.appInfo': {
        const params = asRecord(request.params);
        requireOnlyKeys(params, []);
        return {
          appId,
          version: plugin.version,
          sdkVersion: plugin.manifest.sdkVersion,
          protocolVersion: 1,
          displayName: plugin.manifest.displayName,
          declaredCapabilities: [...plugin.manifest.capabilities],
        };
      }
      case 'storage.get': {
        const params = asRecord(request.params);
        requireOnlyKeys(params, ['key']);
        return storageRecordJson(await this.storage.get(scope, requireStorageKey(params.key)));
      }
      case 'storage.put': {
        const params = asRecord(request.params);
        requireOnlyKeys(params, ['key', 'value', 'expectedVersion']);
        const expectedVersion = params.expectedVersion;
        if (expectedVersion !== null && (!Number.isSafeInteger(expectedVersion) || (expectedVersion as number) < 1)) {
          throw new Error('PLUGIN_FRONTEND_RPC_INVALID');
        }
        if (!Object.prototype.hasOwnProperty.call(params, 'value')) throw new Error('PLUGIN_FRONTEND_RPC_INVALID');
        return storageRecordJson(
          await this.storage.put(
            scope,
            requireStorageKey(params.key),
            params.value as JsonValue,
            expectedVersion as number | null,
          ),
        );
      }
      case 'storage.delete': {
        const params = asRecord(request.params);
        requireOnlyKeys(params, ['key', 'expectedVersion']);
        if (!Number.isSafeInteger(params.expectedVersion) || (params.expectedVersion as number) < 1) {
          throw new Error('PLUGIN_FRONTEND_RPC_INVALID');
        }
        return {
          deleted: await this.storage.delete(scope, requireStorageKey(params.key), params.expectedVersion as number),
        };
      }
      case 'intents.create': {
        const params = asRecord(request.params);
        requireOnlyKeys(params, ['receiverAppId', 'intentId', 'input', 'artifactRefs', 'confirmed']);
        if (!Object.prototype.hasOwnProperty.call(params, 'input') || params.confirmed !== true) {
          throw new Error('PLUGIN_FRONTEND_RPC_INVALID');
        }
        return (await this.appIntents.createConfirmed(
          scope,
          {
            receiverAppId: requireRpcString(params.receiverAppId),
            intentId: requireRpcString(params.intentId),
            input: params.input as JsonValue,
            artifactRefs: requireIntentArtifactRefs(params.artifactRefs),
            confirmed: true,
          },
          operationId,
        )) as unknown as JsonValue;
      }
      case 'intents.listReceived': {
        const params = asRecord(request.params);
        requireOnlyKeys(params, ['limit']);
        const limit = params.limit;
        if (limit !== undefined && (!Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > 100)) {
          throw new Error('PLUGIN_FRONTEND_RPC_INVALID');
        }
        return (await this.appIntents.listReceived(scope, limit as number | undefined)) as unknown as JsonValue;
      }
      case 'intents.revoke': {
        const params = asRecord(request.params);
        requireOnlyKeys(params, ['receiptId']);
        await this.appIntents.revoke(scope, requireRpcString(params.receiptId, 128));
        return { revoked: true };
      }
      case 'intents.artifacts.get': {
        const params = asRecord(request.params);
        requireOnlyKeys(params, ['receiptId', 'artifactId']);
        return (await this.appIntents.getReceivedArtifact(
          scope,
          requireRpcString(params.receiptId, 128),
          requireRpcString(params.artifactId),
        )) as unknown as JsonValue;
      }
      default:
        throw new Error('PLUGIN_FRONTEND_RPC_METHOD_DENIED');
    }
  }
}
