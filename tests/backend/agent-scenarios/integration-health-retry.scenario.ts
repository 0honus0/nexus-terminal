import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { ClockPort, Scope } from '../../../packages/backend/src/modules/agent/agent.types';
import type { IntegrationRepositoryPort } from '../../../packages/backend/src/modules/agent/ai/integration.repository.port';
import { IntegrationService } from '../../../packages/backend/src/modules/agent/ai/integration.service';
import type { IntegrationServiceHooks } from '../../../packages/backend/src/modules/agent/ai/integration.service';
import type {
  IntegrationManagementView,
  IntegrationView,
  McpRuntimePort,
} from '../../../packages/backend/src/modules/agent/ai/integrations.types';

export const integrationHealthRetryScenario = async () => {
  const scope: Scope = { userId: 1, appId: 'integration-health-app' };
  const integrationId = '00000000-0000-4000-8000-000000000109';
  const configuration = (generation: number) => ({
    displayName: `health-generation-${generation}`,
    transport: 'streamable-http' as const,
    endpoint: `https://example.com/health-g${generation}`,
    privateHostExceptions: [] as string[],
    protocolVersion: '2026-07-28' as const,
  });
  let now = 1_800_950_000;
  let current: IntegrationView | null = {
    ...scope,
    id: integrationId,
    kind: 'mcp',
    configuration: configuration(1),
    hasCredential: false,
    credentialRevision: 1,
    schemaHash: null,
    enabled: true,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  const clone = (): IntegrationView | null => (current ? structuredClone(current) : null);
  let blockAfterSchemaHashCommit = false;
  let signalSchemaHashCommitted!: () => void;
  let releaseSchemaHashCommit!: () => void;
  const schemaHashCommitted = new Promise<void>((resolve) => {
    signalSchemaHashCommitted = resolve;
  });
  const schemaHashCommitReleased = new Promise<void>((resolve) => {
    releaseSchemaHashCommit = resolve;
  });
  const repository: IntegrationRepositoryPort = {
    get: async () => clone(),
    list: async (_scope, kind) => {
      const value = clone();
      return value && (!kind || value.kind === kind) ? [value] : [];
    },
    create: async () => {
      throw new Error('UNEXPECTED_CREATE');
    },
    update: async (_scope, _id, expectedVersion, record) => {
      if (!current) throw new Error('INTEGRATION_NOT_FOUND');
      if (current.version !== expectedVersion) throw new Error('INTEGRATION_VERSION_CONFLICT');
      current = {
        ...current,
        configuration: record.configuration,
        enabled: record.enabled,
        schemaHash: null,
        credentialRevision:
          record.credential !== undefined || record.clearCredential
            ? current.credentialRevision + 1
            : current.credentialRevision,
        hasCredential: record.credential !== undefined ? true : record.clearCredential ? false : current.hasCredential,
        version: current.version + 1,
        updatedAt: record.updatedAt,
      };
      return clone()!;
    },
    updateSchemaHash: async (_scope, _id, expectedVersion, expectedCredentialRevision, schemaHash, updatedAt) => {
      if (!current) return null;
      if (current.version !== expectedVersion || current.credentialRevision !== expectedCredentialRevision) return null;
      current = { ...current, schemaHash, updatedAt };
      const committed = clone();
      if (blockAfterSchemaHashCommit) {
        blockAfterSchemaHashCommit = false;
        signalSchemaHashCommitted();
        await schemaHashCommitReleased;
      }
      return committed;
    },
    remove: async (_scope, _id, expectedVersion) => {
      if (!current) throw new Error('INTEGRATION_NOT_FOUND');
      if (current.version !== expectedVersion) throw new Error('INTEGRATION_VERSION_CONFLICT');
      current = null;
    },
  };
  let remoteAvailable = false;
  const refreshCalls: number[] = [];
  const mcp: McpRuntimePort = {
    close: async () => undefined,
    closeAll: async () => undefined,
    invoke: async () => ({ kind: 'complete', isError: false, content: null, structuredContent: null }),
    readResource: async () => ({ kind: 'complete', contents: [] }),
    getPrompt: async () => ({ kind: 'complete', description: null, messages: [] }),
    refresh: async (integration) => {
      refreshCalls.push(integration.version);
      if (!remoteAvailable) throw new Error('MCP_CONNECTION_FAILED');
      return {
        serverName: 'health-server',
        serverVersion: `${integration.version}`,
        protocolVersion: '2026-07-28',
        tools: [
          {
            remoteName: `health_tool_v${integration.version}`,
            title: null,
            description: 'health retry scenario tool',
            inputSchema: { type: 'object' },
            outputSchema: null,
            annotations: null,
          },
        ],
        resources: [],
        prompts: [],
      };
    },
  };
  const contributions = new Set<string>();
  const hooks: IntegrationServiceHooks = {
    removed: (_scope, id) => contributions.delete(id),
    mcpRefreshed: (_scope, integration) => contributions.add(integration.id),
  };
  const service = new IntegrationService(
    repository,
    {
      resolve: async (url) => {
        const parsed = new URL(url);
        return {
          url,
          protocol: parsed.protocol as 'http:' | 'https:',
          hostname: parsed.hostname,
          port: 443,
          authority: parsed.host,
          addresses: ['203.0.113.12'],
          tlsServerName: parsed.hostname,
        };
      },
    },
    mcp,
    null!,
    { sha256Utf8: (value) => createHash('sha256').update(value, 'utf8').digest('hex') },
    { nowUnixSeconds: () => now } as ClockPort,
    hooks,
  );
  const listHealth = async (): Promise<IntegrationManagementView> => {
    const [integration] = await service.list(scope, 'mcp');
    assert.ok(integration);
    return integration;
  };
  const retryDue = async (): Promise<number> =>
    (service as unknown as { retryDue(limit?: number): Promise<number> }).retryDue(8);

  const initial = await listHealth();
  assert.equal(initial.refreshState, 'idle', 'enabled but not refreshed MCP must not be presented as ready');

  await assert.rejects(() => service.refresh(scope, integrationId), /MCP_CONNECTION_FAILED/);
  const failed = await listHealth();
  assert.equal(failed.refreshState, 'error');
  assert.equal(failed.lastErrorCode, 'MCP_CONNECTION_FAILED');
  assert.equal(failed.lastAttemptAt, now);
  assert.equal(failed.lastSuccessAt, null);
  assert.ok(failed.nextRetryAt && failed.nextRetryAt > now, 'refresh failure must schedule bounded retry');
  assert.equal(contributions.has(integrationId), false, 'failed generation must not remain published');

  const disabled = await service.update(scope, integrationId, 1, {
    kind: 'mcp',
    configuration: configuration(2),
    enabled: false,
  });
  assert.equal(disabled.version, 2);
  assert.equal(disabled.refreshState, 'idle');
  assert.equal(disabled.nextRetryAt, null, 'disable must cancel old retry');
  const callsBeforeDisabledSweep = refreshCalls.length;
  now = (failed.nextRetryAt ?? now) + 1;
  assert.equal(await retryDue(), 0, 'disabled integration must not be retried');
  assert.equal(refreshCalls.length, callsBeforeDisabledSweep);

  const enabled = await service.update(scope, integrationId, 2, {
    kind: 'mcp',
    configuration: configuration(3),
    enabled: true,
  });
  assert.equal(enabled.version, 3);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const failedV3 = await listHealth();
  assert.equal(failedV3.refreshState, 'error');
  assert.ok(failedV3.nextRetryAt && failedV3.nextRetryAt > now);

  remoteAvailable = true;
  now = (failedV3.nextRetryAt ?? now) + 1;
  assert.equal(await retryDue(), 1, 'due failed MCP integration must be retried once');
  const ready = await listHealth();
  assert.equal(ready.refreshState, 'ready');
  assert.equal(ready.lastErrorCode, null);
  assert.equal(ready.nextRetryAt, null);
  assert.equal(ready.lastSuccessAt, now);
  assert.equal(current?.version, 3);
  assert.notEqual(current?.schemaHash, null);
  assert.equal(contributions.has(integrationId), true, 'successful retry must restore Tool contribution');
  assert.equal(refreshCalls.filter((version) => version === 1).length, 1, 'old failed generation must never retry');

  blockAfterSchemaHashCommit = true;
  const staleAfterSchemaCommit = service.refresh(scope, integrationId);
  await schemaHashCommitted;
  const disabledAfterSchemaCommit = await service.update(scope, integrationId, 3, {
    kind: 'mcp',
    configuration: configuration(4),
    enabled: false,
  });
  assert.equal(disabledAfterSchemaCommit.version, 4);
  assert.equal(contributions.has(integrationId), false, 'disable must remove the current Tool contribution');
  releaseSchemaHashCommit();
  await assert.rejects(staleAfterSchemaCommit, /INTEGRATION_REFRESH_STALE/);
  assert.equal(
    contributions.has(integrationId),
    false,
    'a refresh whose schema CAS completed before disable must not republish the stale Tool contribution',
  );

  remoteAvailable = false;
  const enabledForRemoval = await service.update(scope, integrationId, 4, {
    kind: 'mcp',
    configuration: configuration(5),
    enabled: true,
  });
  assert.equal(enabledForRemoval.version, 5);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const failedV5 = await listHealth();
  assert.equal(failedV5.refreshState, 'error');
  assert.ok(failedV5.nextRetryAt && failedV5.nextRetryAt > now);
  const callsBeforeRemove = refreshCalls.length;
  await service.remove(scope, integrationId, 5);
  now = (failedV5.nextRetryAt ?? now) + 1;
  assert.equal(await retryDue(), 0, 'removed integration must not retain a scheduled retry');
  assert.equal(refreshCalls.length, callsBeforeRemove);
  assert.equal(contributions.has(integrationId), false, 'remove must keep Tool contribution absent');

  return [
    { name: 'mcp_health_error_projections', value: 1, unit: 'integrations' },
    { name: 'disabled_old_generation_retries', value: 0, unit: 'retries' },
    { name: 'post_cas_stale_publications', value: 0, unit: 'publications' },
    { name: 'removed_generation_retries', value: 0, unit: 'retries' },
    { name: 'automatic_retry_recoveries', value: 1, unit: 'integrations' },
    { name: 'ready_tool_contributions_restored', value: 1, unit: 'integrations' },
  ];
};
