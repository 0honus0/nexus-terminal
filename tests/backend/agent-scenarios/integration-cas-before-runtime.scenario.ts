import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { ClockPort, Scope } from '../../../packages/backend/src/modules/agent/agent.types';
import type { IntegrationRepositoryPort } from '../../../packages/backend/src/modules/agent/ai/integration.repository.port';
import { IntegrationService } from '../../../packages/backend/src/modules/agent/ai/integration.service';
import type { IntegrationServiceHooks } from '../../../packages/backend/src/modules/agent/ai/integration.service';
import type {
  IntegrationView,
  McpRuntimePort,
} from '../../../packages/backend/src/modules/agent/ai/integrations.types';

export const integrationCasBeforeRuntimeScenario = async () => {
  const scope: Scope = { userId: 1, appId: 'integration-cas-app' };
  const integrationId = '00000000-0000-4000-8000-000000000105';
  const configuration = (displayName: string, endpoint: string) => ({
    displayName,
    transport: 'streamable-http' as const,
    endpoint,
    privateHostExceptions: [] as string[],
    protocolVersion: '2026-07-28' as const,
  });
  let current: IntegrationView | null = {
    ...scope,
    id: integrationId,
    kind: 'mcp',
    configuration: configuration('v2', 'https://example.com/v2'),
    hasCredential: false,
    credentialRevision: 1,
    schemaHash: 'schema-v2',
    enabled: true,
    version: 2,
    createdAt: 1_800_800_000,
    updatedAt: 1_800_800_000,
  };
  const clone = (): IntegrationView | null => (current ? structuredClone(current) : null);
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
      if (!current) throw new Error('INTEGRATION_NOT_FOUND');
      if (current.version !== expectedVersion || current.credentialRevision !== expectedCredentialRevision) return null;
      current = { ...current, schemaHash, updatedAt };
      return clone();
    },
    remove: async (_scope, _id, expectedVersion) => {
      if (!current) throw new Error('INTEGRATION_NOT_FOUND');
      if (current.version !== expectedVersion) throw new Error('INTEGRATION_VERSION_CONFLICT');
      current = null;
    },
  };
  let failRefresh = false;
  const closeCalls: string[] = [];
  const refreshCalls: number[] = [];
  const mcp: McpRuntimePort = {
    close: async (id) => {
      closeCalls.push(id);
    },
    closeAll: async () => undefined,
    invoke: async () => ({ kind: 'complete', isError: false, content: null, structuredContent: null }),
    readResource: async () => ({ kind: 'complete', contents: [] }),
    getPrompt: async () => ({ kind: 'complete', description: null, messages: [] }),
    refresh: async (integration) => {
      refreshCalls.push(integration.version);
      if (failRefresh) throw new Error('INJECTED_REFRESH_FAILURE');
      return {
        serverName: 'scenario-mcp',
        serverVersion: '1',
        protocolVersion: '2026-07-28',
        tools: [],
        resources: [],
        prompts: [],
      };
    },
  };
  const contributions = new Set<string>([integrationId]);
  const removedCalls: string[] = [];
  const refreshedCalls: number[] = [];
  const hooks: IntegrationServiceHooks = {
    removed: (_scope, id) => {
      removedCalls.push(id);
      contributions.delete(id);
    },
    mcpRefreshed: (_scope, integration) => {
      refreshedCalls.push(integration.version);
      contributions.add(integration.id);
    },
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
          port: parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80,
          authority: parsed.host,
          addresses: ['203.0.113.10'],
          tlsServerName: parsed.hostname,
        };
      },
    },
    mcp,
    null!,
    { sha256Utf8: (value) => createHash('sha256').update(value, 'utf8').digest('hex') },
    { nowUnixSeconds: () => 1_800_800_100 } as ClockPort,
    hooks,
  );
  const updateInput = (displayName: string, endpoint: string, enabled: boolean) => ({
    kind: 'mcp',
    configuration: configuration(displayName, endpoint),
    enabled,
  });

  await assert.rejects(
    () => service.update(scope, integrationId, 1, updateInput('stale', 'https://example.com/stale', false)),
    /INTEGRATION_VERSION_CONFLICT/,
  );
  assert.equal(current?.version, 2);
  assert.equal(closeCalls.length, 0, 'stale update must not close the live MCP session');
  assert.equal(removedCalls.length, 0, 'stale update must not remove the Tool contribution');
  assert.equal(contributions.has(integrationId), true);

  await assert.rejects(() => service.remove(scope, integrationId, 1), /INTEGRATION_VERSION_CONFLICT/);
  assert.equal(current?.version, 2);
  assert.equal(closeCalls.length, 0, 'stale remove must not close the live MCP session');
  assert.equal(removedCalls.length, 0, 'stale remove must not remove the Tool contribution');
  assert.equal(contributions.has(integrationId), true);

  const disabled = await service.update(
    scope,
    integrationId,
    2,
    updateInput('disabled-v3', 'https://example.com/v3', false),
  );
  assert.equal(disabled.version, 3);
  assert.equal(disabled.enabled, false);
  assert.deepEqual(closeCalls, [integrationId]);
  assert.deepEqual(removedCalls, [integrationId]);
  assert.equal(contributions.has(integrationId), false);

  failRefresh = true;
  const enabled = await service.update(
    scope,
    integrationId,
    3,
    updateInput('enabled-v4', 'https://example.com/v4', true),
  );
  assert.equal(enabled.version, 4);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(current?.version, 4);
  assert.equal(current?.schemaHash, null, 'failed runtime reconcile must leave durable refresh-needed state');
  assert.equal(contributions.has(integrationId), false, 'failed refresh must not publish a stale Tool contribution');
  assert.equal(refreshedCalls.length, 0);
  assert.ok(refreshCalls.includes(4));

  failRefresh = false;
  await service.syncEnabled(scope);
  assert.equal(current?.schemaHash === null, false, 'syncEnabled must be able to retry the failed refresh');
  assert.equal(contributions.has(integrationId), true);
  assert.ok(refreshedCalls.includes(4));

  const versionBeforeRemove = current!.version;
  await service.remove(scope, integrationId, versionBeforeRemove);
  assert.equal(current, null);
  assert.equal(contributions.has(integrationId), false);

  return [
    { name: 'stale_cas_runtime_side_effects', value: 0, unit: 'effects' },
    { name: 'successful_runtime_switches', value: 3, unit: 'transitions' },
    { name: 'refresh_failures_retried', value: 1, unit: 'integrations' },
  ];
};
