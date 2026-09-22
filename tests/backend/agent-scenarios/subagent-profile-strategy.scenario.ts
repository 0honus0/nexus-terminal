import assert from 'node:assert/strict';
import type { ClockPort, Scope } from '../../../packages/backend/src/modules/agent/agent.types';
import { ToolCatalog } from '../../../packages/backend/src/modules/agent/capabilities/tool-catalog';
import { CapabilityRegistry } from '../../../packages/backend/src/modules/agent/host/capability-registry';
import { SubagentContextBuilder } from '../../../packages/backend/src/modules/agent/runtime/collaboration/subagent-context-builder';
import { SubagentPolicyService } from '../../../packages/backend/src/modules/agent/runtime/collaboration/subagent-policy';
import { projectSubagentCollaborationContext } from '../../../packages/backend/src/modules/agent/runtime/collaboration/subagent-context-projection';
import type {
  MailboxReaderPort,
  RuntimeParticipantRepositoryPort,
  RuntimeParticipantView,
} from '../../../packages/backend/src/modules/agent/runtime/collaboration/subagent.repository.port';
import type { DelegationView } from '../../../packages/backend/src/modules/agent/runtime/collaboration/subagent.types';
import { freezeRunContextPolicy } from '../../../packages/backend/src/modules/agent/runtime/runs/run-budget-policy';
import type { RunView } from '../../../packages/backend/src/modules/agent/runtime/runs/run.types';
import { emptyModelContinuations } from './scenario-fixtures';
import { contextService, entry } from './scenario-context-helpers';

export const subagentProfileStrategyScenario = async () => {
  const scenarioScope: Scope = { userId: 1, appId: 'subagent-profile-strategy-app' };
  const modelRef = { providerId: 'scenario-provider', modelId: 'scenario-model', configurationVersion: 1 };
  const storedProfile = {
    id: 'custom-worker',
    role: 'Existing custom worker',
    defaultModel: modelRef,
    allowedModels: [modelRef],
    capabilities: [],
    peerMessaging: 'parent-child',
    mutationMode: 'read-only',
    maxSteps: 9,
    failureMode: 'isolate',
  };
  const policy = new SubagentPolicyService(
    {
      get: async () => ({
        key: 'subagent.profiles.v1',
        value: { profiles: [storedProfile] },
        bytes: 256,
        version: 3,
        updatedAt: 1_800_560_000,
      }),
      put: async () => {
        throw new Error('UNEXPECTED_PUT');
      },
      delete: async () => false,
    },
    {
      get: async () => ({
        effectiveSettings: {
          subagents: {
            maxDelegationDepth: 3,
            maxSubagentMessagesPerRun: 1_000,
            maxSubagentMessageBytesPerRun: 2_097_152,
          },
          hardLimits: { maxRunSteps: 64 },
        },
      }),
    } as never,
    null!,
  );
  const view = await policy.get(scenarioScope);
  assert.deepEqual(
    view.policy.profiles.map((profile) => profile.id),
    ['custom-worker'],
    'built-in templates must not silently replace or persist over existing custom profiles',
  );
  const templates = view.templates;
  assert.deepEqual(
    templates.map((template) => template.id),
    ['explore', 'scout', 'review', 'general', 'worker'],
    'Subagent settings must expose the bounded built-in template catalog including the explicit governed worker',
  );
  assert.ok(
    templates.find((template) => template.id === 'worker')?.capabilities.includes('file.write'),
    'the worker template must request explicit Workspace write access',
  );
  assert.ok(
    templates.find((template) => template.id === 'scout')?.capabilities.includes('browser.read'),
    'the scout template must request browser read access without browser interaction by default',
  );
  const rootProjection = projectSubagentCollaborationContext(view, []);
  assert.match(rootProjection ?? '', /custom-worker/, 'Root projection must expose configured executable profile ids');
  assert.match(
    rootProjection ?? '',
    /Handle small local tasks in the Root agent/,
    'Root projection must discourage fixed fan-out',
  );
  assert.match(
    rootProjection ?? '',
    /do not inherit the Root raw conversation or Recall/,
    'Root projection must describe the lightweight Child context boundary',
  );
  assert.match(rootProjection ?? '', /"presetOnly":true/, 'built-in templates must be clearly non-executable presets');

  const runtime: RuntimeParticipantView = {
    id: 'profile-strategy-child-runtime',
    runId: 'profile-strategy-run',
    participantId: 'subagent:profile-strategy-delegation',
    backendKind: 'native',
    modelRef,
    status: 'running',
    scheduleState: 'runnable',
    consumedMailboxSequence: 0,
  };
  const delegation: DelegationView = {
    ...scenarioScope,
    id: 'profile-strategy-delegation',
    runId: runtime.runId,
    parentRuntimeId: 'profile-strategy-root-runtime',
    childRuntimeId: runtime.id,
    profileId: 'custom-worker',
    grants: [],
    peerMessaging: 'parent-child',
    mutationMode: 'read-only',
    modelRef,
    objective: 'Review src/parser/index.ts without changing files.',
    constraints: ['Focus on src/parser and report evidence only.'],
    inputArtifactRefs: [],
    completionCriteria: ['Identify parser risks.'],
    dependencyMode: 'settled',
    status: 'running',
    depth: 1,
    failureMode: 'isolate',
    budget: { maxSteps: 9 },
    usage: { tokens: 0, steps: 0 },
    result: null,
    evidenceRefs: [],
    deadlineAt: 1_900_000_000,
    version: 1,
    createdAt: 1_800_560_000,
    updatedAt: 1_800_560_000,
    completedAt: null,
  };
  const crowdedSettings = {
    ...view,
    policy: {
      ...view.policy,
      profiles: Array.from({ length: 32 }, (_, index) => ({
        ...view.policy.profiles[0]!,
        id: `crowded-profile-${index + 1}`,
        role: `Crowded profile ${index + 1}: ${'bounded role detail '.repeat(12)}`,
      })),
    },
  };
  const crowdedDelegations = Array.from({ length: 40 }, (_, index) => ({
    ...delegation,
    id: `crowded-delegation-${index + 1}`,
    childRuntimeId: `crowded-child-${index + 1}`,
    objective: `Crowded objective ${index + 1}: ${'bounded delegation detail '.repeat(24)}`,
    result: { summary: 'bounded result detail '.repeat(40) },
    evidenceRefs: Array.from({ length: 16 }, (__, evidenceIndex) => `artifact-${index + 1}-${evidenceIndex + 1}`),
  }));
  const boundedRootProjection = projectSubagentCollaborationContext(crowdedSettings, crowdedDelegations);
  assert.ok(boundedRootProjection);
  assert.ok(Buffer.byteLength(boundedRootProjection, 'utf8') <= 8 * 1024);
  const boundedRootState = JSON.parse(boundedRootProjection) as {
    omittedConfiguredProfiles: number;
    omittedDirectDelegations: number;
  };
  assert.ok(
    boundedRootState.omittedConfiguredProfiles > 0 || boundedRootState.omittedDirectDelegations > 0,
    'bounded Root collaboration projection must report omitted state instead of truncating JSON mid-document',
  );

  const tighterRootProjection = projectSubagentCollaborationContext(crowdedSettings, crowdedDelegations, 4 * 1024);
  assert.ok(tighterRootProjection);
  assert.ok(
    Buffer.byteLength(tighterRootProjection, 'utf8') <= 4 * 1024,
    'Root collaboration projection must honor a caller-supplied tighter byte budget',
  );

  let inheritedRuntimeId = '';
  let inheritedTargets: string[] = [];
  const childContext = new SubagentContextBuilder(
    {
      runtime: async () => runtime,
      recentRuntimeToolExchanges: async () => [],
    } as unknown as RuntimeParticipantRepositoryPort,
    { readMessages: async () => [], listDelegationMessages: async () => [] } as MailboxReaderPort,
    { discover: () => [] } as unknown as ToolCatalog,
    new CapabilityRegistry(),
    emptyModelContinuations,
    null!,
    { nowUnixSeconds: () => 1_800_560_000 } as ClockPort,
    {
      load: async (_scope, _runId, runtimeId, targetDirectories) => {
        inheritedRuntimeId = runtimeId;
        inheritedTargets = [...targetDirectories];
        return {
          workspaceId: 'profile-strategy-workspace',
          generation: 1,
          targetDirectories: [...targetDirectories],
          instructions: [
            {
              path: '/workspace/work/AGENTS.md',
              scopePath: '/workspace/work',
              projectRoot: '/workspace/work',
              hash: 'a'.repeat(64),
              content: 'PROJECT_CHILD_MARKER: parser work must remain read-only.',
              sourceBytes: 64,
              contentBytes: 64,
              truncated: false,
              provenance: 'workspace',
            },
          ],
          omitted: [],
        };
      },
    },
  );
  const prepared = await childContext.prepare(
    scenarioScope,
    runtime.runId,
    runtime.id,
    delegation,
    {
      id: 'scenario-model',
      contextWindow: 16_384,
      maxOutputTokens: 2_048,
      supportsTools: true,
      supportsImageInput: false,
      supportsFileInput: false,
    } as Parameters<SubagentContextBuilder['prepare']>[4],
    {
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        steps: 0,
        subagentMessages: 0,
        subagentMessageBytes: 0,
      },
      budget: { maxRunSteps: 64, maxToolOutputBytes: 1_048_576, contextPolicy: freezeRunContextPolicy('normal') },
      definition: { environment: { transport: 'workspace-profile' } },
    } as unknown as RunView,
  );
  assert.equal(prepared.kind, 'ready');
  if (prepared.kind !== 'ready') throw new Error('SCENARIO_INVALID');
  assert.equal(
    inheritedRuntimeId,
    delegation.parentRuntimeId,
    'Child project instructions must be inherited from the parent runtime Workspace without copying Root history',
  );
  assert.ok(
    inheritedTargets.includes('/workspace/work/src/parser'),
    'delegation objective/constraints must narrow inherited project-instruction targets',
  );
  assert.match(JSON.stringify(prepared.plan.instructions), /PROJECT_CHILD_MARKER/);
  assert.match(
    prepared.plan.instructions[0] ?? '',
    /do not inherit the Root agent raw conversation, Recall, or private model context/,
  );

  const rootHistory = Array.from({ length: 80 }, (_, index) =>
    entry(
      index + 1,
      index % 2 === 0 ? 'user_input' : 'assistant_message',
      {
        text: `ROOT_RAW_HISTORY_MARKER ${index + 1}: ${'repository exploration detail '.repeat(18)}`,
      },
      'profile-strategy-run',
    ),
  );
  const rootPlan = await contextService(rootHistory).compose({
    scope: scenarioScope,
    threadId: 'scenario-thread',
    runId: 'profile-strategy-run',
    currentInput: 'Continue the parser review.',
    modelContextWindow: 16_384,
    maxContextTokens: 14_000,
    reservedOutputTokens: 2_048,
    maxRecallItems: 5,
    maxRecallBytes: 8_192,
    tools: [],
  });
  assert.match(JSON.stringify(rootPlan.messages), /ROOT_RAW_HISTORY_MARKER/);
  assert.doesNotMatch(
    JSON.stringify({ instructions: prepared.plan.instructions, messages: prepared.plan.messages }),
    /ROOT_RAW_HISTORY_MARKER/,
    'Child context must not fork the Root raw Ledger history',
  );
  assert.ok(
    rootPlan.estimatedInputTokens > prepared.plan.estimatedInputTokens * 2,
    'representative delegated exploration must materially reduce prompt-resident context versus the Root history',
  );

  return [
    { name: 'custom_profiles_preserved', value: view.policy.profiles.length, unit: 'profiles' },
    { name: 'built_in_profile_templates', value: templates.length, unit: 'templates' },
    { name: 'child_project_instruction_targets', value: inheritedTargets.length, unit: 'targets' },
    {
      name: 'child_context_token_reduction',
      value: rootPlan.estimatedInputTokens - prepared.plan.estimatedInputTokens,
      unit: 'tokens',
    },
  ];
};
