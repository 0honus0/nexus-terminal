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

export const integrationRefreshGenerationScenario = async () => {
  const scope: Scope = { userId: 1, appId: 'integration-refresh-app' };
  const integrationId = '00000000-0000-4000-8000-000000000106';
  const configuration = (generation: number) => ({
    displayName: `generation-${generation}`,
    transport: 'streamable-http' as const,
    endpoint: `https://example.com/g${generation}`,
    privateHostExceptions: [] as string[],
    protocolVersion: '2026-07-28' as const,
  });
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
    createdAt: 1_800_900_000,
    updatedAt: 1_800_900_000,
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
      if (!current) return null;
      if (current.version !== expectedVersion || current.credentialRevision !== expectedCredentialRevision) return null;
      current = { ...current, schemaHash, updatedAt };
      return clone();
    },
    remove: async () => {
      throw new Error('UNEXPECTED_REMOVE');
    },
  };

  let releaseGeneration1!: () => void;
  const generation1Barrier = new Promise<void>((resolve) => {
    releaseGeneration1 = resolve;
  });
  let generation1Started!: () => void;
  const generation1StartedPromise = new Promise<void>((resolve) => {
    generation1Started = resolve;
  });
  let releaseGeneration2!: () => void;
  let blockGeneration2 = false;
  const generation2Barrier = new Promise<void>((resolve) => {
    releaseGeneration2 = resolve;
  });
  let generation2Started!: () => void;
  const generation2StartedPromise = new Promise<void>((resolve) => {
    generation2Started = resolve;
  });
  const closeCalls: number[] = [];
  const mcp: McpRuntimePort = {
    close: async () => {
      closeCalls.push(current?.version ?? -1);
    },
    closeAll: async () => undefined,
    invoke: async () => ({ kind: 'complete', isError: false, content: null, structuredContent: null }),
    readResource: async () => ({ kind: 'complete', contents: [] }),
    getPrompt: async () => ({ kind: 'complete', description: null, messages: [] }),
    refresh: async (integration) => {
      if (integration.version === 1) {
        generation1Started();
        await generation1Barrier;
      }
      if (integration.version === 2 && blockGeneration2) {
        generation2Started();
        await generation2Barrier;
      }
      return {
        serverName: `server-v${integration.version}`,
        serverVersion: `${integration.version}`,
        protocolVersion: '2026-07-28',
        tools: [
          {
            remoteName: `tool_v${integration.version}_c${integration.credentialRevision}`,
            title: null,
            description: `tool for generation ${integration.version}`,
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
  const publishedTools: string[] = [];
  let publishedGeneration = 0;
  let generation2Published!: () => void;
  let generation3Published!: () => void;
  const generation2PublishedPromise = new Promise<void>((resolve) => {
    generation2Published = resolve;
  });
  const generation3PublishedPromise = new Promise<void>((resolve) => {
    generation3Published = resolve;
  });
  const hooks: IntegrationServiceHooks = {
    removed: () => {
      publishedTools.length = 0;
    },
    mcpRefreshed: (_scope, integration, snapshot) => {
      publishedGeneration = integration.version;
      publishedTools.splice(0, publishedTools.length, ...snapshot.tools.map((tool) => tool.remoteName));
      if (integration.version === 2) generation2Published();
      if (integration.version === 3) generation3Published();
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
          port: 443,
          authority: parsed.host,
          addresses: ['203.0.113.11'],
          tlsServerName: parsed.hostname,
        };
      },
    },
    mcp,
    null!,
    { sha256Utf8: (value) => createHash('sha256').update(value, 'utf8').digest('hex') },
    { nowUnixSeconds: () => 1_800_900_100 } as ClockPort,
    hooks,
  );
  const updateInput = (generation: number, credential?: string) => ({
    kind: 'mcp',
    configuration: configuration(generation),
    enabled: true,
    ...(credential === undefined ? {} : { credential }),
  });

  const staleV1 = service.refresh(scope, integrationId);
  await generation1StartedPromise;
  const v2 = await service.update(scope, integrationId, 1, updateInput(2));
  assert.equal(v2.version, 2);
  assert.equal(v2.schemaHash, null);
  releaseGeneration1();
  await assert.rejects(staleV1, /INTEGRATION_REFRESH_STALE/);
  await generation2PublishedPromise;
  assert.equal(current?.version, 2);
  assert.notEqual(current?.schemaHash, null);
  assert.equal(publishedGeneration, 2);
  assert.deepEqual(publishedTools, ['tool_v2_c1']);
  assert.equal(publishedTools.includes('tool_v1_c1'), false, 'stale v1 descriptor must never reach ToolCatalog');

  blockGeneration2 = true;
  const staleV2 = service.refresh(scope, integrationId);
  await generation2StartedPromise;
  const v3 = await service.update(scope, integrationId, 2, updateInput(2, 'credential-v2'));
  assert.equal(v3.version, 3);
  assert.equal(v3.credentialRevision, 2);
  assert.equal(v3.schemaHash, null);
  releaseGeneration2();
  await assert.rejects(staleV2, /INTEGRATION_REFRESH_STALE/);
  await generation3PublishedPromise;
  assert.equal(current?.version, 3);
  assert.equal(current?.credentialRevision, 2);
  assert.notEqual(current?.schemaHash, null);
  assert.equal(publishedGeneration, 3);
  assert.deepEqual(publishedTools, ['tool_v3_c2']);
  assert.equal(publishedTools.includes('tool_v2_c1'), false, 'credential-stale descriptor must never be republished');

  return [
    { name: 'stale_refreshes_published', value: 0, unit: 'refreshes' },
    { name: 'generation_safe_refreshes', value: 2, unit: 'refreshes' },
    { name: 'credential_generation_races', value: 1, unit: 'races' },
    { name: 'stale_sessions_closed', value: closeCalls.length > 0 ? 1 : 0, unit: 'checks' },
  ];
};
