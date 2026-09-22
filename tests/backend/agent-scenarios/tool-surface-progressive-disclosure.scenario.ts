import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { ClockPort, JsonValue } from '../../../packages/backend/src/modules/agent/agent.types';
import { ToolCatalog } from '../../../packages/backend/src/modules/agent/capabilities/tool-catalog';
import { PolicyService } from '../../../packages/backend/src/modules/agent/capabilities/policy.service';
import { ToolExecutor } from '../../../packages/backend/src/modules/agent/capabilities/tool-executor';
import type { AgentTool, ToolContext } from '../../../packages/backend/src/modules/agent/capabilities/tool.types';
import { AppCapabilityBroker } from '../../../packages/backend/src/modules/agent/host/app-capability-broker';
import { CapabilityRegistry } from '../../../packages/backend/src/modules/agent/host/capability-registry';
import { estimateTokens } from '../../../packages/backend/src/modules/agent/ai/model-accounting';
import type { MutationLeaseGuardHandle } from '../../../packages/backend/src/modules/agent/runtime/execution/mutation-lease-guard.port';
import { ToolCallRunner } from '../../../packages/backend/src/modules/agent/runtime/execution/tool-call-runner';
import { createToolSearchTool } from '../../../packages/backend/src/modules/agent/tools/host/tool-discovery-tools';
import { SubagentContextBuilder } from '../../../packages/backend/src/modules/agent/runtime/collaboration/subagent-context-builder';
import type {
  MailboxReaderPort,
  RuntimeParticipantRepositoryPort,
  RuntimeParticipantView,
} from '../../../packages/backend/src/modules/agent/runtime/collaboration/subagent.repository.port';
import type { DelegationView } from '../../../packages/backend/src/modules/agent/runtime/collaboration/subagent.types';
import { freezeRunContextPolicy } from '../../../packages/backend/src/modules/agent/runtime/runs/run-budget-policy';
import type { RunView } from '../../../packages/backend/src/modules/agent/runtime/runs/run.types';
import { emptyModelContinuations, scope } from './scenario-fixtures';
import { contextService } from './scenario-context-helpers';

export const toolSurfaceProgressiveDisclosureScenario = async () => {
  const catalog = new ToolCatalog();
  const cryptoHash = { sha256Utf8: (value: string) => createHash('sha256').update(value, 'utf8').digest('hex') };
  const executedToolNames: string[] = [];
  const inertTool = (input: {
    name: string;
    capability: AgentTool['descriptor']['capability'];
    riskClass: AgentTool['descriptor']['riskClass'];
    version: string;
    description: string;
    modelExposure?: AgentTool['descriptor']['modelExposure'];
  }): AgentTool => ({
    descriptor: {
      name: input.name,
      version: input.version,
      description: input.description,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string', minLength: 1, maxLength: 256 },
          path: { type: 'string', minLength: 1, maxLength: 512 },
          options: {
            type: 'object',
            additionalProperties: true,
          },
        },
      },
      riskClass: input.riskClass,
      ...(input.modelExposure ? { modelExposure: input.modelExposure } : {}),
      capability: input.capability,
    },
    inspect: async (argumentsValue, context, policyRevision) => {
      const mutation = input.riskClass === 'mutate' || input.riskClass === 'destructive';
      return {
        toolName: input.name,
        toolVersion: input.version,
        normalizedArguments: argumentsValue,
        target: {
          kind: 'run',
          targetIdentity: `run:${context.runId}:${input.name}`,
          endpoint: `scenario:${input.name}`,
          loginUser: `agent-runtime:${context.agentRuntimeId}`,
          configurationHash: `surface:${input.name}:${input.version}`,
        },
        resourceKeys: [`surface:${input.name}`],
        risk: input.riskClass,
        mutation,
        operationHash: `surface:${input.name}:${input.version}:${policyRevision}`,
        operationHashVersion: 1,
        preconditions: [],
        policyRevision,
        inputRevision: context.inputRevision,
      };
    },
    execute: async () => {
      executedToolNames.push(input.name);
      return {
        ok: true,
        summary: `${input.name} completed.`,
        data: { tool: input.name },
        artifactRefs: [],
        truncated: false,
        outcome: 'confirmed',
        verification: { status: 'verified', summary: 'Scenario Tool completed.', evidenceRefs: [] },
      };
    },
  });
  const core = inertTool({
    name: 'scenario_core_read',
    riskClass: 'read',
    version: '1.0.0',
    description: 'Frequently used built-in read tool that must remain directly available.',
  });
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'scenario.core-tools',
    tools: [core],
  });
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'scenario.tool-discovery',
    tools: [createToolSearchTool(catalog, cryptoHash)],
  });
  const mcpTools = (count: number, version = 'mcp:surface-v1'): AgentTool[] =>
    Array.from({ length: count }, (_, index) =>
      inertTool({
        name: `mcp_surface_${String(index).padStart(3, '0')}`,
        capability: 'integration.mcp.invoke',
        riskClass: 'mutate',
        version,
        modelExposure: 'deferred',
        description:
          `High-cardinality MCP tool ${index}. ` +
          'This deliberately verbose description represents remote protocol metadata that should not be sent on every model step. '.repeat(
            3,
          ),
      }),
    );
  catalog.replaceOwnedContribution(scope, 'mcp:surface-fixture', {
    schemaVersion: 1,
    id: 'scenario.mcp.surface',
    tools: mcpTools(120),
  });

  const authorizedCapabilities: string[] = [];
  const capabilities = {
    authorize: async (_context: ToolContext, capability: string) => {
      authorizedCapabilities.push(capability);
      return { allowed: true as const, policyRevision: 7 };
    },
  } as unknown as AppCapabilityBroker;
  const executor = new ToolExecutor(catalog, capabilities);
  const runner = new ToolCallRunner(catalog, executor, new PolicyService(), null!, null!);
  const context: ToolContext = {
    ...scope,
    actor: {
      kind: 'agent',
      userId: scope.userId,
      appId: scope.appId,
      runId: 'tool-surface-run',
      agentRuntimeId: 'tool-surface-runtime',
    },
    runId: 'tool-surface-run',
    agentRuntimeId: 'tool-surface-runtime',
    connectionIds: [],
    environment: null,
    stepId: 'tool-surface-step',
    signal: new AbortController().signal,
    deadlineAt: 1_800_500_000,
    maxOutputBytes: 16 * 1024,
    inputRevision: 3,
  };

  const fullSchemas = catalog.schemas(scope);
  const fullTokens = estimateTokens(JSON.stringify(fullSchemas));
  const projected = runner.schemas(scope, { environment: null }, 'execute');
  const projectedTokens = estimateTokens(JSON.stringify(projected));
  const projectedNames = new Set(projected.map((tool) => tool.name));

  assert.equal(
    fullSchemas.length,
    122,
    'fixture must expose core/discovery Tools plus 120 MCP Tools in the authoritative catalog',
  );
  assert.ok(projectedNames.has('scenario_core_read'), 'frequent built-in Tool must remain directly model-visible');
  assert.ok(projectedNames.has('tool_search'), 'large deferred Tool catalogs must expose bounded discovery');
  assert.ok(projectedNames.has('tool_invoke'), 'large deferred Tool catalogs must expose one stable invoke router');
  assert.equal(
    projected.some((tool) => tool.name.startsWith('mcp_surface_')),
    false,
    'individual MCP schemas must not remain resident in the model-facing Tool surface',
  );
  assert.ok(
    projectedTokens < Math.floor(fullTokens * 0.25),
    `projected Tool schema tokens must materially shrink: full=${fullTokens}, projected=${projectedTokens}`,
  );

  const searched = await executor.invoke(context, {
    providerCallId: 'surface-search-call',
    name: 'tool_search',
    argumentsJson: JSON.stringify({ query: 'mcp_surface_042', limit: 3 }),
  });
  assert.equal(searched.result.ok, true);
  assert.ok(
    Buffer.byteLength(JSON.stringify(searched.result), 'utf8') <= context.maxOutputBytes,
    'tool_search result must remain bounded before the generic ToolResult projector',
  );
  const searchData = searched.result.data;
  assert.ok(searchData && !Array.isArray(searchData) && typeof searchData === 'object');
  const matches = (searchData as Record<string, JsonValue>).matches;
  assert.ok(Array.isArray(matches) && matches.length >= 1, 'tool_search must return a matching deferred Tool handle');
  const firstMatch = matches[0];
  assert.ok(firstMatch && !Array.isArray(firstMatch) && typeof firstMatch === 'object');
  const handle = (firstMatch as Record<string, JsonValue>).handle;
  assert.equal(typeof handle, 'string');

  const routed = await runner.inspect(
    context,
    {
      providerCallId: 'surface-invoke-call',
      name: 'tool_invoke',
      argumentsJson: JSON.stringify({ handle, arguments: { query: 'needle' } }),
    },
    'execute',
  );
  assert.equal(
    routed.proposal.name,
    'mcp_surface_042',
    'tool_invoke must resolve to the authoritative MCP Tool before inspect',
  );
  assert.equal(routed.inspection.toolName, 'mcp_surface_042');
  assert.equal(routed.inspection.mutation, true);
  assert.equal(
    routed.policyDecision.action,
    'requireApproval',
    'deferred mutation must retain the original policy/approval decision',
  );
  assert.equal(
    authorizedCapabilities.at(-1),
    'integration.mcp.invoke',
    'resolved invocation must authorize the actual Tool capability through ToolExecutor',
  );
  let mutationLeaseActivations = 0;
  const routedLease: MutationLeaseGuardHandle = {
    signal: context.signal,
    activate: async () => {
      mutationLeaseActivations += 1;
    },
    stopRenewal: async () => null,
    quarantine: async () => undefined,
    confirm: async () => ({ ok: true }),
    releaseIfInactive: async () => undefined,
  };
  const routedResult = await runner.executeMutation(routedLease, context, routed.inspection);
  assert.equal(routedResult.ok, true);
  assert.equal(mutationLeaseActivations, 1, 'deferred mutation must still activate the normal mutation lease');
  assert.equal(
    executedToolNames.at(-1),
    'mcp_surface_042',
    'tool_invoke must execute the resolved authoritative Tool rather than a parallel router implementation',
  );
  await assert.rejects(
    () =>
      runner.inspect(context, {
        providerCallId: 'surface-direct-hidden-call',
        name: 'mcp_surface_042',
        argumentsJson: JSON.stringify({ query: 'needle' }),
      }),
    /MODEL_TOOL_CALL_INVALID/,
    'a deferred MCP Tool must not be directly callable by guessing its hidden local name',
  );

  const stableProjection = JSON.stringify(projected);
  catalog.replaceOwnedContribution(scope, 'mcp:surface-fixture', {
    schemaVersion: 1,
    id: 'scenario.mcp.surface',
    tools: mcpTools(121),
  });
  const refreshedProjection = runner.schemas(scope, { environment: null }, 'execute');
  assert.equal(
    JSON.stringify(refreshedProjection),
    stableProjection,
    'adding an unrelated deferred MCP Tool must not churn the always-on Tool schema prefix',
  );
  const projectionContext = contextService([]);
  const contextInput = {
    scope,
    threadId: 'scenario-thread',
    runId: 'scenario-run',
    currentInput: 'Find and invoke the relevant deferred integration tool.',
    modelContextWindow: 8_192,
    maxContextTokens: 8_192,
    reservedOutputTokens: 256,
    maxRecallItems: 4,
    maxRecallBytes: 4_096,
    tools: projected,
  } as const;
  const beforeRefreshContext = await projectionContext.compose(contextInput);
  const afterRefreshContext = await projectionContext.compose({ ...contextInput, tools: refreshedProjection });
  assert.equal(
    afterRefreshContext.toolSchemaHash,
    beforeRefreshContext.toolSchemaHash,
    'unrelated deferred MCP catalog changes must preserve the model-facing toolSchemaHash',
  );
  assert.equal(
    afterRefreshContext.tokenDiagnostics.toolSchemaTokens,
    beforeRefreshContext.tokenDiagnostics.toolSchemaTokens,
  );
  assert.equal(
    catalog.require('mcp_surface_120', scope).descriptor.capability,
    'integration.mcp.invoke',
    'deferred Tool must remain in the authoritative ToolCatalog',
  );

  catalog.replaceOwnedContribution(scope, 'mcp:surface-fixture', {
    schemaVersion: 1,
    id: 'scenario.mcp.surface',
    tools: mcpTools(121, 'mcp:surface-v2'),
  });
  await assert.rejects(
    () =>
      runner.inspect(context, {
        providerCallId: 'surface-stale-call',
        name: 'tool_invoke',
        argumentsJson: JSON.stringify({ handle, arguments: { query: 'needle' } }),
      }),
    /RESOURCE_CHANGED/,
    'version-bound deferred handles must fail closed after MCP schema refresh',
  );

  const planProjection = runner.schemas(scope, { environment: null }, 'plan');
  assert.equal(
    planProjection.some(
      (tool) => tool.name === 'tool_search' || tool.name === 'tool_invoke' || tool.name.startsWith('mcp_surface_'),
    ),
    false,
    'plan mode must not expose MCP mutation discovery/router or deferred mutation Tools',
  );

  const childRuntime: RuntimeParticipantView = {
    id: 'tool-surface-child-runtime',
    runId: 'tool-surface-child-run',
    participantId: 'child:tool-surface-delegation',
    backendKind: 'native',
    modelRef: { providerId: 'scenario-provider', modelId: 'scenario-model', configurationVersion: 1 },
    status: 'running',
    scheduleState: 'runnable',
    consumedMailboxSequence: 0,
  };
  const childContext = new SubagentContextBuilder(
    {
      runtime: async () => childRuntime,
      recentRuntimeToolExchanges: async () => [],
    } as unknown as RuntimeParticipantRepositoryPort,
    {
      readMessages: async () => [],
      listDelegationMessages: async () => [],
    } as MailboxReaderPort,
    catalog,
    new CapabilityRegistry(),
    emptyModelContinuations,
    null!,
    { nowUnixSeconds: () => 1_800_000_000 } as ClockPort,
  );
  const childDelegation = {
    id: 'tool-surface-delegation',
    runId: childRuntime.runId,
    parentRuntimeId: 'root-runtime',
    childRuntimeId: childRuntime.id,
    profileId: 'default',
    grants: [{ capability: 'integration.mcp.invoke', schemaVersion: 2, scope: { kind: 'global' } }],
    peerMessaging: 'parent-child',
    mutationMode: 'read-only',
    modelRef: childRuntime.modelRef,
    objective: 'Inspect integration metadata without mutating external state.',
    constraints: [],
    inputArtifactRefs: [],
    completionCriteria: [],
    dependencyMode: 'settled',
    status: 'running',
    depth: 1,
    failureMode: 'isolate',
    budget: { maxSteps: 8 },
    usage: { tokens: 0, steps: 0 },
    result: null,
    evidenceRefs: [],
    deadlineAt: 1_900_000_000,
    version: 1,
    createdAt: 1_800_000_000,
    updatedAt: 1_800_000_000,
    completedAt: null,
    ...scope,
  } satisfies DelegationView;
  const childPrepared = await childContext.prepare(
    scope,
    childRuntime.runId,
    childRuntime.id,
    childDelegation,
    {
      id: 'scenario-model',
      contextWindow: 16_384,
      maxOutputTokens: 2_048,
      supportsTools: true,
      supportsImageInput: false,
      supportsFileInput: false,
    },
    {
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        steps: 0,
        subagentMessages: 0,
        subagentMessageBytes: 0,
      },
      budget: { maxRunSteps: 32, maxToolOutputBytes: 16 * 1024, contextPolicy: freezeRunContextPolicy('normal') },
      definition: { environment: null },
    } as unknown as RunView,
  );
  assert.equal(childPrepared.kind, 'ready');
  if (childPrepared.kind !== 'ready') throw new Error('SCENARIO_INVALID');
  assert.equal(
    childPrepared.plan.offeredTools.some(
      (tool) => tool.name === 'tool_search' || tool.name === 'tool_invoke' || tool.name.startsWith('mcp_surface_'),
    ),
    false,
    'Subagent read/control surface must not accidentally expose the Root-only MCP mutation discovery/router path',
  );

  return [
    { name: 'authoritative_catalog_tools', value: 123, unit: 'tools' },
    { name: 'model_visible_tools', value: projected.length, unit: 'tools' },
    { name: 'full_schema_tokens', value: fullTokens, unit: 'tokens' },
    { name: 'projected_schema_tokens', value: projectedTokens, unit: 'tokens' },
    { name: 'deferred_mcp_tools', value: 121, unit: 'tools' },
    {
      name: 'routed_mutation_approval_decisions',
      value: routed.policyDecision.action === 'requireApproval' ? 1 : 0,
      unit: 'calls',
    },
    { name: 'mutation_lease_activations', value: mutationLeaseActivations, unit: 'calls' },
    { name: 'child_mcp_router_exposures', value: 0, unit: 'tools' },
    { name: 'stale_handle_rejections', value: 1, unit: 'calls' },
    { name: 'direct_hidden_tool_rejections', value: 1, unit: 'calls' },
    { name: 'stable_tool_schema_hashes', value: 1, unit: 'cases' },
  ];
};
