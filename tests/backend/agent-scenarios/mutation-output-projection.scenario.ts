import assert from 'node:assert/strict';
import type { Scope } from '../../../packages/backend/src/modules/agent/agent.types';
import { ToolCatalog } from '../../../packages/backend/src/modules/agent/capabilities/tool-catalog';
import {
  projectToolResult,
  ToolExecutor,
} from '../../../packages/backend/src/modules/agent/capabilities/tool-executor';
import type {
  AgentTool,
  ToolContext,
  ToolInspection,
} from '../../../packages/backend/src/modules/agent/capabilities/tool.types';
import { AppCapabilityBroker } from '../../../packages/backend/src/modules/agent/host/app-capability-broker';
import type { MutationLeaseGuardHandle } from '../../../packages/backend/src/modules/agent/runtime/execution/mutation-lease-guard.port';
import { ToolCallRunner } from '../../../packages/backend/src/modules/agent/runtime/execution/tool-call-runner';

export const mutationOutputProjectionScenario = async () => {
  const catalog = new ToolCatalog();
  const capabilities = {
    authorize: async () => ({ allowed: true as const, policyRevision: 1 }),
  } as unknown as AppCapabilityBroker;
  const executor = new ToolExecutor(catalog, capabilities);
  const scope: Scope = { userId: 1, appId: 'tool-projection-app' };
  const context: ToolContext = {
    ...scope,
    actor: {
      kind: 'agent',
      userId: 1,
      appId: scope.appId,
      runId: 'tool-projection-run',
      agentRuntimeId: 'tool-projection-runtime',
    },
    runId: 'tool-projection-run',
    agentRuntimeId: 'tool-projection-runtime',
    connectionIds: [],
    environment: null,
    stepId: 'tool-projection-step',
    signal: new AbortController().signal,
    deadlineAt: 1_800_700_100,
    maxOutputBytes: 2_048,
    inputRevision: 0,
  };
  const executionCounts = new Map<string, number>();
  const inspectionFor = (toolName: string): ToolInspection => ({
    toolName,
    toolVersion: '1',
    normalizedArguments: {},
    target: {
      kind: 'run',
      targetIdentity: `run:${context.runId}:${toolName}`,
      endpoint: `run:${context.runId}`,
      loginUser: `agent-runtime:${context.agentRuntimeId}`,
      configurationHash: `projection-${toolName}`,
    },
    resourceKeys: [`projection:${toolName}`],
    risk: 'mutate',
    mutation: true,
    operationHash: `projection-${toolName}`,
    operationHashVersion: 1,
    preconditions: [],
    policyRevision: 1,
    inputRevision: 0,
  });
  const largeTool = (toolName: string, transport: string): AgentTool => ({
    descriptor: {
      name: toolName,
      version: '1',
      description: `${transport} mutation with a deliberately large protocol-complete response`,
      inputSchema: { type: 'object', additionalProperties: false },
      riskClass: 'mutate',
    },
    inspect: async () => inspectionFor(toolName),
    execute: async () => {
      executionCounts.set(toolName, (executionCounts.get(toolName) ?? 0) + 1);
      return {
        ok: true,
        summary: `${transport} mutation completed. ${'summary '.repeat(2_000)}`,
        data: {
          transport,
          ready: true,
          content: 'x'.repeat(160_000),
          structuredContent: {
            status: 'ok',
            rows: Array.from({ length: 256 }, (_, index) => ({ index, value: 'y'.repeat(512) })),
          },
        },
        artifactRefs: [`artifact-${transport}`],
        truncated: false,
        outcome: 'confirmed',
        verification: {
          status: 'verified',
          summary: `The ${transport} endpoint returned a protocol-complete success response. ${'verified '.repeat(500)}`,
          evidenceRefs: [`evidence-${transport}`],
        },
      };
    },
  });
  const interruptedToolName = 'scenario_transport_interruption';
  const interruptedTool: AgentTool = {
    descriptor: {
      name: interruptedToolName,
      version: '1',
      description: 'Mutation whose transport fails before a complete response is available',
      inputSchema: { type: 'object', additionalProperties: false },
      riskClass: 'mutate',
    },
    inspect: async () => inspectionFor(interruptedToolName),
    execute: async () => {
      executionCounts.set(interruptedToolName, (executionCounts.get(interruptedToolName) ?? 0) + 1);
      throw new Error('ECONNRESET');
    },
  };
  const transportTools = [
    largeTool('scenario_mcp_mutation', 'mcp'),
    largeTool('scenario_acp_mutation', 'acp'),
    largeTool('scenario_workspace_mutation', 'workspace'),
  ];
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'scenario.output-projection',
    tools: [...transportTools, interruptedTool],
  });

  for (const tool of transportTools) {
    const rawResult = await executor.executeMutation(context, inspectionFor(tool.descriptor.name));
    assert.equal(rawResult.outcome, 'confirmed');
    assert.equal(rawResult.ok, true);
    assert.equal(rawResult.verification.status, 'verified');
    assert.equal(rawResult.truncated, false, 'ToolExecutor must preserve the raw execution result');
    assert.ok(
      Buffer.byteLength(JSON.stringify(rawResult), 'utf8') > context.maxOutputBytes,
      'fixture raw mutation result must exceed the model-facing projection budget',
    );
    const result = projectToolResult(rawResult, context.maxOutputBytes);
    assert.equal(result.truncated, true);
    assert.ok(Buffer.byteLength(JSON.stringify(result), 'utf8') <= context.maxOutputBytes);
    assert.equal(executionCounts.get(tool.descriptor.name), 1, `${tool.descriptor.name} must execute exactly once`);
    assert.ok(result.data && typeof result.data === 'object' && !Array.isArray(result.data));
    assert.equal((result.data as Record<string, unknown>).ready, true, 'small control scalars must survive projection');
  }

  const noopLease: MutationLeaseGuardHandle = {
    signal: context.signal,
    stopRenewal: async () => null,
    activate: async () => undefined,
    quarantine: async () => undefined,
    confirm: async () => ({ ok: true }),
    releaseIfInactive: async () => undefined,
  };
  const runner = new ToolCallRunner(catalog, executor, null!, null!, null!);
  const interrupted = await runner.executeMutation(noopLease, context, inspectionFor(interruptedToolName));
  assert.equal(interrupted.outcome, 'unknown');
  assert.equal(interrupted.errorCode, 'ECONNRESET');
  assert.equal(executionCounts.get(interruptedToolName), 1);

  return [
    { name: 'large_confirmed_mutations', value: transportTools.length, unit: 'tools' },
    { name: 'mutation_replays', value: 0, unit: 'tools' },
    { name: 'transport_interruptions_unknown', value: interrupted.outcome === 'unknown' ? 1 : 0, unit: 'tools' },
  ];
};
