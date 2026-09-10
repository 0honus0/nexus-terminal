import { randomUUID } from 'node:crypto';
import type { ClockPort, JsonValue, Scope } from '../agent.types';
import type { CryptoHashPort } from '../crypto-hash.port';
import { hashOperation } from '../operation-hash';
import type { AppLifecycleService } from '../host/app-lifecycle.service';
import { isAgentUuid } from '../uuid';
import type { IntegrationRepositoryPort } from './integration.repository.port';
import type {
  AcpIntegrationConfiguration,
  IntegrationConfiguration,
  IntegrationKind,
  IntegrationRefreshView,
  IntegrationView,
  McpConnectionSnapshot,
  McpIntegrationConfiguration,
  McpRuntimePort,
} from './integrations.types';
import type { OutboundPolicyPort } from './outbound-policy.port';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const nonEmpty = (value: unknown, maxBytes = 1024): value is string =>
  typeof value === 'string' && value.trim().length > 0 && Buffer.byteLength(value.trim(), 'utf8') <= maxBytes;

const validateException = (value: string): string => {
  const normalized = value.trim().toLowerCase();
  const match = /^(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+):(\d{1,5})$/.exec(normalized);
  const port = match ? Number(match[1]) : 0;
  if (!match || port < 1 || port > 65535) throw new Error('INTEGRATION_PRIVATE_EXCEPTION_INVALID');
  return normalized;
};

const validateMcp = async (raw: unknown, outbound: OutboundPolicyPort): Promise<McpIntegrationConfiguration> => {
  if (!isRecord(raw)) throw new Error('VALIDATION_FAILED');
  const allowed = new Set(['displayName', 'transport', 'endpoint', 'privateHostExceptions', 'protocolVersion']);
  if (Object.keys(raw).some((key) => !allowed.has(key))) throw new Error('VALIDATION_FAILED');
  if (
    !nonEmpty(raw.displayName, 256) ||
    raw.transport !== 'streamable-http' ||
    !nonEmpty(raw.endpoint, 2048) ||
    raw.protocolVersion !== '2026-07-28' ||
    !Array.isArray(raw.privateHostExceptions) ||
    raw.privateHostExceptions.length > 32 ||
    raw.privateHostExceptions.some((value) => !nonEmpty(value, 512))
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  let endpoint: URL;
  try {
    endpoint = new URL(raw.endpoint);
  } catch {
    throw new Error('INTEGRATION_ENDPOINT_INVALID');
  }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
    throw new Error('INTEGRATION_ENDPOINT_INVALID');
  const privateHostExceptions = [...new Set((raw.privateHostExceptions as string[]).map(validateException))].sort();
  const normalizedEndpoint = endpoint.toString();
  await outbound.resolve(normalizedEndpoint, privateHostExceptions);
  return {
    displayName: raw.displayName.trim(),
    transport: 'streamable-http',
    endpoint: normalizedEndpoint,
    privateHostExceptions,
    protocolVersion: '2026-07-28',
  };
};

const validateAcp = (raw: unknown): AcpIntegrationConfiguration => {
  if (!isRecord(raw)) throw new Error('VALIDATION_FAILED');
  const allowed = new Set(['displayName', 'transport', 'profileId', 'protocolVersion']);
  if (Object.keys(raw).some((key) => !allowed.has(key))) throw new Error('VALIDATION_FAILED');
  if (
    !nonEmpty(raw.displayName, 256) ||
    raw.transport !== 'environment-profile' ||
    !nonEmpty(raw.profileId, 128) ||
    !/^[a-z][a-z0-9_.-]{0,127}$/.test(raw.profileId) ||
    raw.protocolVersion !== '1'
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  return {
    displayName: raw.displayName.trim(),
    transport: 'environment-profile',
    profileId: raw.profileId,
    protocolVersion: '1',
  };
};

export interface IntegrationServiceHooks {
  mcpRefreshed(scope: Scope, integration: IntegrationView, snapshot: McpConnectionSnapshot, schemaHash: string): void;
  removed(scope: Scope, integrationId: string): void;
}

export class IntegrationService {
  constructor(
    private readonly repository: IntegrationRepositoryPort,
    private readonly outbound: OutboundPolicyPort,
    private readonly mcp: McpRuntimePort,
    private readonly lifecycle: AppLifecycleService,
    private readonly cryptoHash: CryptoHashPort,
    private readonly clock: ClockPort,
    private readonly hooks: IntegrationServiceHooks,
  ) {}

  list(scope: Scope, kind?: IntegrationKind): Promise<IntegrationView[]> {
    return this.repository.list(scope, kind);
  }

  async get(scope: Scope, integrationId: string): Promise<IntegrationView> {
    if (!isAgentUuid(integrationId)) throw new Error('VALIDATION_FAILED');
    const integration = await this.repository.get(scope, integrationId);
    if (!integration) throw new Error('INTEGRATION_NOT_FOUND');
    return integration;
  }

  async create(scope: Scope, raw: unknown): Promise<IntegrationView> {
    await this.lifecycle.get(scope);
    const parsed = await this.parseInput(raw, false);
    const now = this.clock.nowUnixSeconds();
    const created = await this.repository.create({
      id: randomUUID(),
      scope,
      kind: parsed.kind,
      configuration: parsed.configuration,
      enabled: parsed.enabled,
      ...(parsed.credential === undefined ? {} : { credential: parsed.credential }),
      createdAt: now,
    });
    if (created.enabled && created.kind === 'mcp') void this.refresh(scope, created.id).catch(() => undefined);
    return created;
  }

  async update(scope: Scope, integrationId: string, expectedVersion: number, raw: unknown): Promise<IntegrationView> {
    if (!isAgentUuid(integrationId) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new Error('VALIDATION_FAILED');
    }
    const current = await this.get(scope, integrationId);
    const parsed = await this.parseInput(raw, true, current.kind);
    await this.mcp.close(integrationId);
    this.hooks.removed(scope, integrationId);
    const updated = await this.repository.update(scope, integrationId, expectedVersion, {
      configuration: parsed.configuration,
      enabled: parsed.enabled,
      ...(parsed.credential === undefined ? {} : { credential: parsed.credential }),
      clearCredential: parsed.clearCredential,
      updatedAt: this.clock.nowUnixSeconds(),
    });
    if (updated.enabled && updated.kind === 'mcp') void this.refresh(scope, updated.id).catch(() => undefined);
    return updated;
  }

  async remove(scope: Scope, integrationId: string, expectedVersion: number): Promise<void> {
    if (!isAgentUuid(integrationId) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new Error('VALIDATION_FAILED');
    }
    await this.mcp.close(integrationId);
    this.hooks.removed(scope, integrationId);
    await this.repository.remove(scope, integrationId, expectedVersion);
  }

  async refresh(scope: Scope, integrationId: string, signal?: AbortSignal): Promise<IntegrationRefreshView> {
    const integration = await this.get(scope, integrationId);
    if (!integration.enabled) throw new Error('INTEGRATION_DISABLED');
    if (integration.kind !== 'mcp') throw new Error('INTEGRATION_REFRESH_UNSUPPORTED');
    await this.mcp.close(integration.id);
    this.hooks.removed(scope, integration.id);
    const snapshot = await this.mcp.refresh(integration, signal);
    const schemaHash = hashOperation(
      {
        schemaVersion: 1,
        integrationId: integration.id,
        integrationVersion: integration.version,
        credentialRevision: integration.credentialRevision,
        protocolVersion: snapshot.protocolVersion,
        server: { name: snapshot.serverName, version: snapshot.serverVersion },
        tools: snapshot.tools.map((tool) => ({
          remoteName: tool.remoteName,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema,
          annotations: tool.annotations,
        })),
      },
      this.cryptoHash,
    );
    await this.repository.updateSchemaHash(scope, integration.id, schemaHash, this.clock.nowUnixSeconds());
    const updated = await this.get(scope, integration.id);
    this.hooks.mcpRefreshed(scope, updated, snapshot, schemaHash);
    return {
      integration: updated,
      serverName: snapshot.serverName,
      serverVersion: snapshot.serverVersion,
      protocolVersion: snapshot.protocolVersion,
      toolCount: snapshot.tools.length,
    };
  }

  async syncEnabled(scope: Scope): Promise<void> {
    for (const integration of await this.repository.list(scope, 'mcp')) {
      if (!integration.enabled) {
        this.hooks.removed(scope, integration.id);
        continue;
      }
      await this.refresh(scope, integration.id).catch(async () => {
        await this.mcp.close(integration.id).catch(() => undefined);
        this.hooks.removed(scope, integration.id);
      });
    }
  }

  async deactivate(scope: Scope): Promise<void> {
    for (const integration of await this.repository.list(scope, 'mcp')) {
      await this.mcp.close(integration.id).catch(() => undefined);
      this.hooks.removed(scope, integration.id);
    }
  }

  private async parseInput(
    raw: unknown,
    updating: boolean,
    expectedKind?: IntegrationKind,
  ): Promise<{
    kind: IntegrationKind;
    configuration: IntegrationConfiguration;
    enabled: boolean;
    credential?: string;
    clearCredential: boolean;
  }> {
    if (!isRecord(raw)) throw new Error('VALIDATION_FAILED');
    const allowed = new Set(['kind', 'configuration', 'enabled', 'credential', 'clearCredential']);
    if (Object.keys(raw).some((key) => !allowed.has(key))) throw new Error('VALIDATION_FAILED');
    if ((raw.kind !== 'mcp' && raw.kind !== 'acp') || (expectedKind && raw.kind !== expectedKind)) {
      throw new Error('VALIDATION_FAILED');
    }
    if (typeof raw.enabled !== 'boolean') throw new Error('VALIDATION_FAILED');
    if (raw.credential !== undefined && (!nonEmpty(raw.credential, 16 * 1024) || raw.kind !== 'mcp')) {
      throw new Error('VALIDATION_FAILED');
    }
    if (raw.clearCredential !== undefined && (typeof raw.clearCredential !== 'boolean' || raw.kind !== 'mcp')) {
      throw new Error('VALIDATION_FAILED');
    }
    if (raw.credential !== undefined && raw.clearCredential === true) throw new Error('VALIDATION_FAILED');
    if (!updating && raw.clearCredential === true) throw new Error('VALIDATION_FAILED');
    const configuration =
      raw.kind === 'mcp' ? await validateMcp(raw.configuration, this.outbound) : validateAcp(raw.configuration);
    return {
      kind: raw.kind,
      configuration,
      enabled: raw.enabled,
      ...(raw.credential === undefined ? {} : { credential: raw.credential.trim() }),
      clearCredential: raw.clearCredential === true,
    };
  }
}
