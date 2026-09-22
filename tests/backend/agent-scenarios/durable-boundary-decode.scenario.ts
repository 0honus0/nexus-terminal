import assert from 'node:assert/strict';
import {
  decodeDurableJsonValue,
  parseRunBudget,
  parseRunDefinition,
  parseRunUsage,
  parseToolInspection,
  parseToolResult,
} from '../../../packages/backend/src/infrastructure/agent/runtime/durable-state-decoders';
import { freezeRunContextPolicy } from '../../../packages/backend/src/modules/agent/runtime/runs/run-budget-policy';
import { SCENARIO_MODEL_CAPABILITIES } from './scenario-fixtures';

export const durableBoundaryDecodeScenario = async () => {
  const budget = {
    maxRunSteps: 100,
    maxActiveExecutionSeconds: 3_600,
    toolTimeoutSeconds: 120,
    maxToolOutputBytes: 65_536,
    maxRecallItems: 5,
    maxRecallBytes: 8_192,
    maxSubagentMessages: 100,
    maxSubagentMessageBytes: 1_048_576,
    contextPolicy: freezeRunContextPolicy('normal'),
    contextCompactionMode: 'balanced',
    revision: 1,
  };
  const usage = {
    inputTokens: 10,
    outputTokens: 2,
    cachedInputTokens: 4,
    steps: 1,
    subagentMessages: 0,
    subagentMessageBytes: 0,
  };
  const definition = {
    schemaVersion: 1,
    agentDefinitionId: 'scenario-agent',
    requiredModelCapabilities: [],
    model: { providerId: 'scenario-provider', modelId: 'scenario-model', configurationVersion: 1 },
    modelCapabilities: SCENARIO_MODEL_CAPABILITIES,
    rootModelRoutes: [],
    approvalMode: 'ask',
    executionMode: 'execute',
    connectionIds: [],
    environment: null,
    policyRevision: 1,
    settingsRevision: 1,
  };
  const inspection = {
    toolName: 'scenario_read_file',
    toolVersion: '1',
    normalizedArguments: { path: 'src/example.ts' },
    target: {
      kind: 'run',
      targetIdentity: 'run:scenario',
      endpoint: 'run:scenario',
      loginUser: 'agent-runtime:scenario',
      configurationHash: 'config-hash',
    },
    resourceKeys: ['run:scenario'],
    risk: 'read',
    mutation: false,
    operationHash: 'operation-hash',
    operationHashVersion: 1,
    preconditions: [],
    policyRevision: 1,
    inputRevision: 1,
  };
  const result = {
    ok: true,
    summary: 'fixture complete',
    data: { ok: true },
    artifactRefs: [],
    truncated: false,
    outcome: 'confirmed',
    verification: { status: 'verified', summary: 'verified fixture', evidenceRefs: [] },
  };

  assert.deepEqual(parseRunBudget(JSON.stringify(budget)), budget);
  assert.deepEqual(parseRunUsage(JSON.stringify(usage)), usage);
  assert.deepEqual(parseRunDefinition(JSON.stringify(definition)), definition);
  assert.deepEqual(parseToolInspection(JSON.stringify(inspection)), inspection);
  assert.deepEqual(parseToolResult(JSON.stringify(result)), result);

  const rejected = [
    () => parseRunUsage(JSON.stringify({ ...usage, steps: undefined })),
    () => parseRunBudget(JSON.stringify({ ...budget, maxContextTokens: '8192' })),
    () => decodeDurableJsonValue(Array.from({ length: 16_385 }, () => 0)),
    () => parseToolResult(JSON.stringify({ ...result, outcome: 'maybe' })),
    () => parseRunDefinition(JSON.stringify({ ...definition, schemaVersion: 2 })),
    () =>
      parseToolInspection(JSON.stringify({ ...inspection, secretRefs: [{ id: 'removed-secret-ref', version: 1 }] })),
    () => parseRunUsage('{broken'),
  ];
  for (const reject of rejected) assert.throws(reject, /AGENT_DURABLE_STATE_INVALID/);

  return [
    { name: 'valid_boundary_payloads', value: 6, unit: 'cases' },
    { name: 'rejected_invalid_boundary_payloads', value: rejected.length, unit: 'cases' },
  ];
};
