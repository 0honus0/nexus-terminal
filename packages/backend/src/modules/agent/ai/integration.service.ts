import { randomUUID } from 'node:crypto';
import { logger } from '../../../shared/logging/logger';
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
  IntegrationManagementView,
  IntegrationRefreshView,
  IntegrationView,
  McpConnectionSnapshot,
  McpIntegrationConfiguration,
  McpRuntimePort,
} from './integrations.types';
import type { OutboundPolicyPort } from './outbound-policy.port';

const MCP_REFRESH_RETRY_DELAYS_SECONDS = [15, 30, 60, 120, 300] as const;
const DEFAULT_MCP_RETRY_SWEEP_LIMIT = 8;

interface IntegrationRuntimeHealthState {
  scope: Scope;
  integrationId: string;
  version: number;
  credentialRevision: number;
  refreshState: IntegrationManagementView['refreshState'];
  lastErrorCode: string | null;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  nextRetryAt: number | null;
  failureCount: number;
}

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
  const allowed = new Set([
    'displayName',
    'transport',
    'endpoint',
    'privateHostExceptions',
    'protocolVersion',
    'trustToolAnnotations',
  ]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) throw new Error('VALIDATION_FAILED');
  if (
    !nonEmpty(raw.displayName, 256) ||
    raw.transport !== 'streamable-http' ||
    !nonEmpty(raw.endpoint, 2048) ||
    raw.protocolVersion !== '2026-07-28' ||
    (raw.trustToolAnnotations !== undefined && typeof raw.trustToolAnnotations !== 'boolean') ||
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
    trustToolAnnotations: raw.trustToolAnnotations === true,
  };
};

const validateAcp = (raw: unknown): AcpIntegrationConfiguration => {
  if (!isRecord(raw)) throw new Error('VALIDATION_FAILED');
  const allowed = new Set(['displayName', 'transport', 'profileId', 'protocolVersion']);
  if (Object.keys(raw).some((key) => !allowed.has(key))) throw new Error('VALIDATION_FAILED');
  if (
    !nonEmpty(raw.displayName, 256) ||
    raw.transport !== 'workspace-profile' ||
    !nonEmpty(raw.profileId, 128) ||
    !/^[a-z][a-z0-9_.-]{0,127}$/.test(raw.profileId) ||
    raw.protocolVersion !== '1'
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  return {
    displayName: raw.displayName.trim(),
    transport: 'workspace-profile',
    profileId: raw.profileId,
    protocolVersion: '1',
  };
};

const refreshErrorCode = (error: unknown): string => {
  const code = error instanceof Error ? error.message.trim() : '';
  return /^[A-Z][A-Z0-9_]{2,127}$/.test(code) ? code : 'INTEGRATION_REFRESH_FAILED';
};

const shouldRetryRefreshError = (code: string): boolean =>
  ![
    'INTEGRATION_DISABLED',
    'INTEGRATION_NOT_FOUND',
    'INTEGRATION_REFRESH_STALE',
    'INTEGRATION_REFRESH_UNSUPPORTED',
    'MCP_PROTOCOL_VERSION_UNSUPPORTED',
    'INTEGRATION_REFRESH_ABORTED',
  ].includes(code);

export interface IntegrationServiceHooks {
  mcpRefreshed(scope: Scope, integration: IntegrationView, snapshot: McpConnectionSnapshot, schemaHash: string): void;
  removed(scope: Scope, integrationId: string): void;
}

export class IntegrationService {
  private readonly refreshTails = new Map<string, Promise<void>>();
  private readonly refreshEpochs = new Map<string, number>();
  private readonly runtimeHealth = new Map<string, IntegrationRuntimeHealthState>();

  constructor(
    private readonly repository: IntegrationRepositoryPort,
    private readonly outbound: OutboundPolicyPort,
    private readonly mcp: McpRuntimePort,
    private readonly lifecycle: AppLifecycleService,
    private readonly cryptoHash: CryptoHashPort,
    private readonly clock: ClockPort,
    private readonly hooks: IntegrationServiceHooks,
  ) {}

  async list(scope: Scope, kind?: IntegrationKind): Promise<IntegrationManagementView[]> {
    return (await this.repository.list(scope, kind)).map((integration) => this.managementView(integration));
  }

  async get(scope: Scope, integrationId: string): Promise<IntegrationManagementView> {
    return this.managementView(await this.getStored(scope, integrationId));
  }

  private async getStored(scope: Scope, integrationId: string): Promise<IntegrationView> {
    if (!isAgentUuid(integrationId)) throw new Error('VALIDATION_FAILED');
    const integration = await this.repository.get(scope, integrationId);
    if (!integration) throw new Error('INTEGRATION_NOT_FOUND');
    return integration;
  }

  async create(scope: Scope, raw: unknown): Promise<IntegrationManagementView> {
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
    this.resetRuntimeHealth(created);
    logger.info(
      {
        userId: scope.userId,
        appId: scope.appId,
        integrationId: created.id,
        kind: created.kind,
        enabled: created.enabled,
        version: created.version,
      },
      'Agent integration created',
    );
    if (created.enabled && created.kind === 'mcp') {
      void this.refresh(scope, created.id).catch((error) =>
        logger.warn(
          {
            err: error,
            errorCode: refreshErrorCode(error),
            userId: scope.userId,
            appId: scope.appId,
            integrationId: created.id,
          },
          'Agent integration initial refresh failed',
        ),
      );
    }
    return this.managementView(created);
  }

  async update(
    scope: Scope,
    integrationId: string,
    expectedVersion: number,
    raw: unknown,
  ): Promise<IntegrationManagementView> {
    if (!isAgentUuid(integrationId) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new Error('VALIDATION_FAILED');
    }
    const current = await this.getStored(scope, integrationId);
    const parsed = await this.parseInput(raw, true, current.kind);
    const updated = await this.repository.update(scope, integrationId, expectedVersion, {
      configuration: parsed.configuration,
      enabled: parsed.enabled,
      ...(parsed.credential === undefined ? {} : { credential: parsed.credential }),
      clearCredential: parsed.clearCredential,
      updatedAt: this.clock.nowUnixSeconds(),
    });
    this.invalidateRefreshEpoch(scope, integrationId);
    this.resetRuntimeHealth(updated);
    await this.mcp
      .close(integrationId)
      .catch((error) =>
        logger.warn(
          { err: error, userId: scope.userId, appId: scope.appId, integrationId },
          'Agent integration runtime close failed during update',
        ),
      );
    this.hooks.removed(scope, integrationId);
    logger.info(
      {
        userId: scope.userId,
        appId: scope.appId,
        integrationId,
        kind: updated.kind,
        enabled: updated.enabled,
        version: updated.version,
        credentialRevision: updated.credentialRevision,
      },
      'Agent integration updated',
    );
    if (updated.enabled && updated.kind === 'mcp') {
      void this.refresh(scope, updated.id).catch((error) =>
        logger.warn(
          { err: error, errorCode: refreshErrorCode(error), userId: scope.userId, appId: scope.appId, integrationId },
          'Agent integration refresh after update failed',
        ),
      );
    }
    return this.managementView(updated);
  }

  async remove(scope: Scope, integrationId: string, expectedVersion: number): Promise<void> {
    if (!isAgentUuid(integrationId) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new Error('VALIDATION_FAILED');
    }
    await this.repository.remove(scope, integrationId, expectedVersion);
    this.invalidateRefreshEpoch(scope, integrationId);
    this.runtimeHealth.delete(this.runtimeHealthKey(scope, integrationId));
    await this.mcp
      .close(integrationId)
      .catch((error) =>
        logger.warn(
          { err: error, userId: scope.userId, appId: scope.appId, integrationId },
          'Agent integration runtime close failed during removal',
        ),
      );
    this.hooks.removed(scope, integrationId);
    logger.info(
      { userId: scope.userId, appId: scope.appId, integrationId, expectedVersion },
      'Agent integration removed',
    );
  }

  async refresh(scope: Scope, integrationId: string, signal?: AbortSignal): Promise<IntegrationRefreshView> {
    return this.serializeRefresh(integrationId, () => this.refreshNow(scope, integrationId, signal));
  }

  private async refreshNow(scope: Scope, integrationId: string, signal?: AbortSignal): Promise<IntegrationRefreshView> {
    const integration = await this.getStored(scope, integrationId);
    if (!integration.enabled) throw new Error('INTEGRATION_DISABLED');
    if (integration.kind !== 'mcp') throw new Error('INTEGRATION_REFRESH_UNSUPPORTED');
    const refreshEpoch = this.refreshEpoch(scope, integration.id);
    this.markRefreshing(integration);
    logger.debug(
      {
        userId: scope.userId,
        appId: scope.appId,
        integrationId: integration.id,
        integrationVersion: integration.version,
        credentialRevision: integration.credentialRevision,
        refreshEpoch,
      },
      'Agent MCP integration refresh started',
    );
    try {
      await this.mcp.close(integration.id);
      this.hooks.removed(scope, integration.id);
      const refreshed = await this.mcp.refresh(integration, signal);
      const snapshot = {
        ...refreshed,
        tools: refreshed.tools ?? [],
        resources: refreshed.resources ?? [],
        prompts: refreshed.prompts ?? [],
      };
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
          resources: snapshot.resources.map((resource) => ({
            uri: resource.uri,
            name: resource.name,
            title: resource.title,
            description: resource.description,
            mimeType: resource.mimeType,
            annotations: resource.annotations,
          })),
          prompts: snapshot.prompts.map((prompt) => ({
            name: prompt.name,
            title: prompt.title,
            description: prompt.description,
            arguments: prompt.arguments,
          })),
        },
        this.cryptoHash,
      );
      const updated = await this.repository.updateSchemaHash(
        scope,
        integration.id,
        integration.version,
        integration.credentialRevision,
        schemaHash,
        this.clock.nowUnixSeconds(),
      );
      if (!updated || this.refreshEpoch(scope, integration.id) !== refreshEpoch) {
        // The network result belongs to an older durable generation. Never publish its schema, and
        // close any session that may have completed after a newer generation or lifecycle invalidation.
        await this.mcp
          .close(integration.id)
          .catch((error) =>
            logger.warn(
              { err: error, userId: scope.userId, appId: scope.appId, integrationId: integration.id },
              'Agent stale MCP refresh cleanup failed',
            ),
          );
        throw new Error('INTEGRATION_REFRESH_STALE');
      }
      this.hooks.mcpRefreshed(scope, updated, snapshot, schemaHash);
      this.markReady(updated);
      logger.info(
        {
          userId: scope.userId,
          appId: scope.appId,
          integrationId: integration.id,
          integrationVersion: updated.version,
          credentialRevision: updated.credentialRevision,
          protocolVersion: snapshot.protocolVersion,
          toolCount: snapshot.tools.length,
          resourceCount: snapshot.resources.length,
          promptCount: snapshot.prompts.length,
          refreshEpoch,
        },
        'Agent MCP integration refresh completed',
      );
      return {
        integration: this.managementView(updated),
        serverName: snapshot.serverName,
        serverVersion: snapshot.serverVersion,
        protocolVersion: snapshot.protocolVersion,
        toolCount: snapshot.tools.length,
        resourceCount: snapshot.resources.length,
        promptCount: snapshot.prompts.length,
      };
    } catch (error) {
      const code = signal?.aborted ? 'INTEGRATION_REFRESH_ABORTED' : refreshErrorCode(error);
      if (this.refreshEpoch(scope, integration.id) === refreshEpoch && code !== 'INTEGRATION_REFRESH_STALE') {
        this.markRefreshError(integration, code);
      }
      logger.warn(
        {
          err: error,
          errorCode: code,
          userId: scope.userId,
          appId: scope.appId,
          integrationId: integration.id,
          integrationVersion: integration.version,
          credentialRevision: integration.credentialRevision,
          refreshEpoch,
          aborted: signal?.aborted === true,
        },
        'Agent MCP integration refresh failed',
      );
      throw error;
    }
  }

  private async serializeRefresh<T>(integrationId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.refreshTails.get(integrationId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.refreshTails.set(integrationId, tail);
    await previous.catch(() => undefined);
    try {
      return await work();
    } finally {
      release();
      void tail.finally(() => {
        if (this.refreshTails.get(integrationId) === tail) this.refreshTails.delete(integrationId);
      });
    }
  }

  async syncEnabled(scope: Scope): Promise<void> {
    for (const integration of await this.repository.list(scope, 'mcp')) {
      if (!integration.enabled) {
        this.invalidateRefreshEpoch(scope, integration.id);
        this.resetRuntimeHealth(integration);
        this.hooks.removed(scope, integration.id);
        continue;
      }
      await this.refresh(scope, integration.id).catch(async (error) => {
        logger.warn(
          {
            err: error,
            errorCode: refreshErrorCode(error),
            userId: scope.userId,
            appId: scope.appId,
            integrationId: integration.id,
          },
          'Agent MCP integration sync refresh failed',
        );
        await this.mcp
          .close(integration.id)
          .catch((closeError) =>
            logger.warn(
              { err: closeError, userId: scope.userId, appId: scope.appId, integrationId: integration.id },
              'Agent MCP integration cleanup after sync failure failed',
            ),
          );
        this.hooks.removed(scope, integration.id);
      });
    }
  }

  async deactivate(scope: Scope): Promise<void> {
    for (const integration of await this.repository.list(scope, 'mcp')) {
      this.invalidateRefreshEpoch(scope, integration.id);
      this.resetRuntimeHealth({ ...integration, enabled: false });
      await this.mcp
        .close(integration.id)
        .catch((error) =>
          logger.warn(
            { err: error, userId: scope.userId, appId: scope.appId, integrationId: integration.id },
            'Agent MCP integration close during deactivation failed',
          ),
        );
      this.hooks.removed(scope, integration.id);
    }
  }

  async retryDue(limit = DEFAULT_MCP_RETRY_SWEEP_LIMIT): Promise<number> {
    const boundedLimit = Math.max(1, Math.min(DEFAULT_MCP_RETRY_SWEEP_LIMIT, Math.trunc(limit)));
    const now = this.clock.nowUnixSeconds();
    const due = [...this.runtimeHealth.values()]
      .filter((state) => state.refreshState === 'error' && state.nextRetryAt !== null && state.nextRetryAt <= now)
      .sort((left, right) => (left.nextRetryAt ?? 0) - (right.nextRetryAt ?? 0))
      .slice(0, boundedLimit);
    const attempted = await Promise.all(
      due.map(async (state) => {
        const integration = await this.repository.get(state.scope, state.integrationId);
        if (
          !integration ||
          integration.kind !== 'mcp' ||
          !integration.enabled ||
          integration.version !== state.version ||
          integration.credentialRevision !== state.credentialRevision
        ) {
          if (integration) this.resetRuntimeHealth(integration);
          else this.runtimeHealth.delete(this.runtimeHealthKey(state.scope, state.integrationId));
          return false;
        }
        const currentHealth = this.matchingRuntimeHealth(integration);
        if (
          currentHealth?.refreshState !== 'error' ||
          currentHealth.nextRetryAt === null ||
          currentHealth.nextRetryAt > this.clock.nowUnixSeconds()
        ) {
          return false;
        }
        await this.refresh(state.scope, state.integrationId).catch((error) =>
          logger.warn(
            {
              err: error,
              errorCode: refreshErrorCode(error),
              userId: state.scope.userId,
              appId: state.scope.appId,
              integrationId: state.integrationId,
              failureCount: state.failureCount,
            },
            'Agent MCP integration scheduled retry failed',
          ),
        );
        return true;
      }),
    );
    return attempted.filter(Boolean).length;
  }

  private runtimeHealthKey(scope: Scope, integrationId: string): string {
    return `${scope.userId}\n${scope.appId}\n${integrationId}`;
  }

  private refreshEpoch(scope: Scope, integrationId: string): number {
    return this.refreshEpochs.get(this.runtimeHealthKey(scope, integrationId)) ?? 0;
  }

  private invalidateRefreshEpoch(scope: Scope, integrationId: string): void {
    const key = this.runtimeHealthKey(scope, integrationId);
    this.refreshEpochs.set(key, this.refreshEpoch(scope, integrationId) + 1);
  }

  private matchingRuntimeHealth(integration: IntegrationView): IntegrationRuntimeHealthState | null {
    const state = this.runtimeHealth.get(this.runtimeHealthKey(integration, integration.id));
    if (
      !state ||
      state.version !== integration.version ||
      state.credentialRevision !== integration.credentialRevision
    ) {
      return null;
    }
    return state;
  }

  private managementView(integration: IntegrationView): IntegrationManagementView {
    const state = integration.kind === 'mcp' ? this.matchingRuntimeHealth(integration) : null;
    return {
      ...integration,
      refreshState: state?.refreshState ?? 'idle',
      lastErrorCode: state?.lastErrorCode ?? null,
      lastAttemptAt: state?.lastAttemptAt ?? null,
      lastSuccessAt: state?.lastSuccessAt ?? null,
      nextRetryAt: state?.nextRetryAt ?? null,
    };
  }

  private resetRuntimeHealth(integration: IntegrationView): void {
    const key = this.runtimeHealthKey(integration, integration.id);
    if (integration.kind !== 'mcp') {
      this.runtimeHealth.delete(key);
      return;
    }
    this.runtimeHealth.set(key, {
      scope: { userId: integration.userId, appId: integration.appId },
      integrationId: integration.id,
      version: integration.version,
      credentialRevision: integration.credentialRevision,
      refreshState: 'idle',
      lastErrorCode: null,
      lastAttemptAt: null,
      lastSuccessAt: null,
      nextRetryAt: null,
      failureCount: 0,
    });
  }

  private markRefreshing(integration: IntegrationView): void {
    const previous = this.matchingRuntimeHealth(integration);
    this.runtimeHealth.set(this.runtimeHealthKey(integration, integration.id), {
      scope: { userId: integration.userId, appId: integration.appId },
      integrationId: integration.id,
      version: integration.version,
      credentialRevision: integration.credentialRevision,
      refreshState: 'refreshing',
      lastErrorCode: null,
      lastAttemptAt: this.clock.nowUnixSeconds(),
      lastSuccessAt: previous?.lastSuccessAt ?? null,
      nextRetryAt: null,
      failureCount: previous?.failureCount ?? 0,
    });
  }

  private markReady(integration: IntegrationView): void {
    const previous = this.matchingRuntimeHealth(integration);
    if (!previous) return;
    this.runtimeHealth.set(this.runtimeHealthKey(integration, integration.id), {
      ...previous,
      refreshState: 'ready',
      lastErrorCode: null,
      lastSuccessAt: this.clock.nowUnixSeconds(),
      nextRetryAt: null,
      failureCount: 0,
    });
  }

  private markRefreshError(integration: IntegrationView, code: string): void {
    const previous = this.matchingRuntimeHealth(integration);
    if (!previous) return;
    const failureCount = previous.failureCount + 1;
    const delay =
      MCP_REFRESH_RETRY_DELAYS_SECONDS[Math.min(failureCount - 1, MCP_REFRESH_RETRY_DELAYS_SECONDS.length - 1)];
    this.runtimeHealth.set(this.runtimeHealthKey(integration, integration.id), {
      ...previous,
      refreshState: 'error',
      lastErrorCode: code,
      nextRetryAt: shouldRetryRefreshError(code) ? this.clock.nowUnixSeconds() + delay : null,
      failureCount,
    });
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
