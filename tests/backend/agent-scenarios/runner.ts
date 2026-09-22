import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  PROJECT_INSTRUCTION_LIMITS,
  resolveProjectInstructions,
} from '../../../packages/agent-runner/src/controller/project-instructions';
import { RunnerJournal } from '../../../packages/agent-runner/src/controller/journal';
import { RunnerControllerServer } from '../../../packages/agent-runner/src/controller/server';
import { DatabaseSync } from 'node:sqlite';
import { AgentNotificationBridge } from '../../../packages/backend/src/bootstrap/agent/agent-notification-bridge';
import { LocalArtifactStore } from '../../../packages/backend/src/infrastructure/agent/artifacts/local-artifact-store';
import { SqliteAgentSettingsRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-agent-settings.repository';
import { SqliteConversationRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-conversation.repository';
import { SqliteContextCheckpointRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-context-checkpoint.repository';
import { SqliteModelContinuationRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-model-continuation.repository';
import { SqliteRecallRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-recall.repository';
import {
  decodePersistedProviderModels,
  SqliteProviderRepository,
} from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-provider.repository';
import { SqliteRunRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-run.repository';
import {
  decodeDurableJsonValue,
  parseRunBudget,
  parseRunDefinition,
  parseRunUsage,
  parseToolInspection,
  parseToolResult,
} from '../../../packages/backend/src/infrastructure/agent/runtime/durable-state-decoders';
import { SqliteStateCommitAdapter } from '../../../packages/backend/src/infrastructure/agent/runtime/sqlite-state-commit.adapter';
import { OpenAiProviderAdapter } from '../../../packages/backend/src/infrastructure/agent/providers/openai-provider.adapter';
import { parseOpenAiCompatibleCapabilityMetadata } from '../../../packages/backend/src/infrastructure/agent/providers/openai-provider-capability-metadata';
import { RunnerHttpAdapter } from '../../../packages/backend/src/infrastructure/agent/workspace-runtime/runner-http.adapter';
import {
  decodeOpenAiResponsesContinuation,
  OpenAiResponsesContinuationCollector,
} from '../../../packages/backend/src/infrastructure/agent/providers/openai-provider-continuation';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import { runMigrations } from '../../../packages/backend/src/infrastructure/database/sqlite-migrations';
import { NotificationService } from '../../../packages/backend/src/modules/notifications/notification.service';
import { logErrorCode } from '../../../packages/backend/src/shared/logging/logger';
import type { ClockPort, JsonValue, Scope } from '../../../packages/backend/src/modules/agent/agent.types';
import {
  AGENT_DEFAULTS,
  createDefaultAgentSettings,
  normalizeRequestedSettings,
} from '../../../packages/backend/src/modules/agent/agent-defaults';
import { LEASE_RENEW_INTERVAL_MS } from '../../../packages/backend/src/modules/agent/capabilities/lease-policy';
import { ToolCatalog } from '../../../packages/backend/src/modules/agent/capabilities/tool-catalog';
import {
  projectToolResult,
  ToolExecutor,
} from '../../../packages/backend/src/modules/agent/capabilities/tool-executor';
import type {
  AgentTool,
  ToolContext,
  ToolInspection,
  ToolResult,
} from '../../../packages/backend/src/modules/agent/capabilities/tool.types';
import type { AgentWorkspaceRepositoryPort } from '../../../packages/backend/src/modules/agent/workspace-runtime/workspace-runtime.repository.port';
import { AppCapabilityBroker } from '../../../packages/backend/src/modules/agent/host/app-capability-broker';
import { CapabilityRegistry } from '../../../packages/backend/src/modules/agent/host/capability-registry';
import { AgentSettingsService } from '../../../packages/backend/src/modules/agent/host/agent-settings.service';
import { AgentExecutionPolicyService } from '../../../packages/backend/src/modules/agent/host/agent-execution-policy.service';
import { TOOL_APPROVAL_TTL_SECONDS } from '../../../packages/backend/src/modules/agent/runtime/approvals/approval-policy';
import { ApprovalService } from '../../../packages/backend/src/modules/agent/runtime/approvals/approval.service';
import { AcpPermissionBroker } from '../../../packages/backend/src/modules/agent/runtime/approvals/acp-permission-broker';
import { toolLeaseTtlSeconds } from '../../../packages/backend/src/modules/agent/runtime/execution/tool-lease-policy';
import { ContextCheckpointService } from '../../../packages/backend/src/modules/agent/ai/context-checkpoint.service';
import { ContextService } from '../../../packages/backend/src/modules/agent/ai/context.service';
import { ArtifactService } from '../../../packages/backend/src/modules/agent/ai/artifact.service';
import {
  projectArtifactsForModel,
  readArtifactTextLinesForAgent,
} from '../../../packages/backend/src/modules/agent/ai/artifact-model-projection';
import type { ArtifactLimitPolicyPort } from '../../../packages/backend/src/modules/agent/ai/artifact.port';
import type { IntegrationRepositoryPort } from '../../../packages/backend/src/modules/agent/ai/integration.repository.port';
import { IntegrationService } from '../../../packages/backend/src/modules/agent/ai/integration.service';
import type { IntegrationServiceHooks } from '../../../packages/backend/src/modules/agent/ai/integration.service';
import type {
  AcpRuntimePort,
  IntegrationView,
  McpRuntimePort,
} from '../../../packages/backend/src/modules/agent/ai/integrations.types';
import { createAcpExecuteTool } from '../../../packages/backend/src/modules/agent/tools/host/acp-tools';
import type { LanguageModelPort } from '../../../packages/backend/src/modules/agent/ai/language-model.port';
import { decodeModelProviderContinuation } from '../../../packages/backend/src/modules/agent/ai/model-continuation';
import {
  applyModelCapabilitySnapshot,
  deriveCapabilityOverrides,
  resolveModelCapabilityDefaults,
  resolveProviderModelConfig,
  snapshotProviderModelCapabilities,
} from '../../../packages/backend/src/modules/agent/ai/model-capability-resolver';
import { ModelCapabilityRegistryService } from '../../../packages/backend/src/modules/agent/ai/model-capability-registry.service';
import { parseModelsDevRegistry } from '../../../packages/backend/src/modules/agent/ai/model-capability-registry-source';
import { installRuntimeModelCapabilityRegistry } from '../../../packages/backend/src/modules/agent/ai/model-capability-registry-runtime';
import type {
  ModelCapabilityRegistryFetchResult,
  ModelCapabilityRegistryPersistedState,
  ModelCapabilityRegistrySourcePort,
  ModelCapabilityRegistryStorePort,
} from '../../../packages/backend/src/modules/agent/ai/model-capability-registry.port';
import type {
  DiscoveredProviderModel,
  ModelEvent,
  ModelProviderContinuation,
  ModelRequest,
  PersistedProviderView,
  ProviderModelCapabilityObservation,
  ProviderView,
  TokenUsage,
} from '../../../packages/backend/src/modules/agent/ai/model.types';
import type {
  ProviderCreateRecord,
  ProviderRepositoryPort,
  ProviderUpdateRecord,
} from '../../../packages/backend/src/modules/agent/ai/provider.repository.port';
import { ProviderService } from '../../../packages/backend/src/modules/agent/ai/provider.service';
import type { LedgerEntryView } from '../../../packages/backend/src/modules/agent/ai/conversation.repository.port';
import { ConversationService } from '../../../packages/backend/src/modules/agent/ai/conversation.service';
import { RecallService } from '../../../packages/backend/src/modules/agent/ai/recall.service';
import {
  SkillRegistry,
  validatePluginSkillDocument,
} from '../../../packages/backend/src/modules/agent/ai/skill-registry';
import type {
  PluginSkillBundle,
  PluginSkillSourcePort,
} from '../../../packages/backend/src/modules/agent/host/plugin-skill-source.port';
import type { BackendSignal } from '../../../packages/backend/src/modules/agent/runtime/execution/agent-backend.port';
import { completionGateDecision } from '../../../packages/backend/src/modules/agent/runtime/execution/completion-gate';
import { ModelCallLimiter } from '../../../packages/backend/src/modules/agent/runtime/execution/model-call-limiter';
import { modelFinishDisposition } from '../../../packages/backend/src/modules/agent/runtime/execution/model-finish-policy';
import { ModelStepRunner } from '../../../packages/backend/src/modules/agent/runtime/execution/model-step-runner';
import { NativeAgentBackend } from '../../../packages/backend/src/modules/agent/runtime/execution/native-agent-backend';
import type { MutationLeaseGuardHandle } from '../../../packages/backend/src/modules/agent/runtime/execution/mutation-lease-guard.port';
import { ToolCallRunner } from '../../../packages/backend/src/modules/agent/runtime/execution/tool-call-runner';
import { createRequestUserInputTool } from '../../../packages/backend/src/modules/agent/tools/host/user-input-tools';
import { createPlanUpdateTool } from '../../../packages/backend/src/modules/agent/runtime/planning/plan-tool';
import {
  createSkillReadTool,
  createSkillSearchTool,
} from '../../../packages/backend/src/modules/agent/tools/host/skill-tools';
import { SubagentContextBuilder } from '../../../packages/backend/src/modules/agent/runtime/collaboration/subagent-context-builder';
import { SubagentCompletionCoordinator } from '../../../packages/backend/src/modules/agent/runtime/collaboration/subagent-completion-coordinator';
import { SubagentPolicyService } from '../../../packages/backend/src/modules/agent/runtime/collaboration/subagent-policy';
import { projectSubagentCollaborationContext } from '../../../packages/backend/src/modules/agent/runtime/collaboration/subagent-context-projection';
import type {
  MailboxReaderPort,
  RuntimeParticipantRepositoryPort,
  RuntimeParticipantView,
  RuntimeToolExchangeView,
} from '../../../packages/backend/src/modules/agent/runtime/collaboration/subagent.repository.port';
import type {
  DelegationView,
  SchedulerWorkView,
} from '../../../packages/backend/src/modules/agent/runtime/collaboration/subagent.types';
import { RunService } from '../../../packages/backend/src/modules/agent/runtime/runs/run.service';
import {
  freezeRunContextPolicy,
  pressureAdjustedToolOutputBytes,
  resolveModelContextBudget,
} from '../../../packages/backend/src/modules/agent/runtime/runs/run-budget-policy';
import type { AtomicCreateRun } from '../../../packages/backend/src/modules/agent/runtime/runs/state-commit.port';
import { createBrowserTools } from '../../../packages/backend/src/modules/agent/tools/host/browser-tools';
import type { RunSnapshot, RunView } from '../../../packages/backend/src/modules/agent/runtime/runs/run.types';
import { runModelRoutes } from '../../../packages/backend/src/modules/agent/runtime/runs/model-routes';
import { agentRoute } from '../../../packages/backend/src/interfaces/http/agent/agent-http';
import {
  parseBudgetIncreaseRequest,
  parseCreateRunRequest,
} from '../../../packages/backend/src/interfaces/http/agent/agent-runtime-route-input';
import { artifactSingleDeleteProductScenario } from './artifact-single-delete-product.scenario';
import { memoryProductClosureScenario } from './memory-product-closure.scenario';
import { pluginAppIntentSdkScenario } from './plugin-app-intent-sdk.scenario';
import { providerPromptCacheHintScenario } from './provider-prompt-cache-hint.scenario';
import {
  clock,
  emptyModelContinuations,
  scenarioDelegationModel,
  SCENARIO_MODEL_CAPABILITIES,
  scope,
} from './scenario-fixtures';
import { unifiedFileCapabilityScenario } from './unified-file-capability.scenario';
import { unifiedShellCapabilityScenario } from './unified-shell-capability.scenario';
import { subagentGovernedMutationScenario } from './subagent-governed-mutation.scenario';
import { restartRecoveryScenario } from './restart-recovery.scenario';
import { checkpointWorkspaceEvidenceScenario } from './checkpoint-workspace-evidence.scenario';
import { workspaceRepoMapCodeIntelScenario } from './workspace-repo-map-code-intel.scenario';
import { workspaceBackgroundJobLifecycleScenario } from './workspace-background-job-lifecycle.scenario';
import { agentDefinitionCapabilityContractScenario } from './agent-definition-capability-contract.scenario';
import { workspaceCodingToolSurfaceScenario } from './workspace-coding-tool-surface.scenario';
import { nestedJoinDurableWakeScenario } from './nested-join-durable-wake.scenario';
import { userInputClarificationScenario } from './user-input-clarification.scenario';
import { mcpInputRequiredDurableLifecycleScenario } from './mcp-input-required-durable-lifecycle.scenario';
import { acpInnerPermissionDurabilityScenario } from './acp-inner-permission-durability.scenario';
import { subagentClaimedCancellationScenario } from './subagent-claimed-cancellation.scenario';
import { completionGateScenario } from './completion-gate.scenario';
import { subagentMailboxTtlScenario } from './subagent-mailbox-ttl.scenario';
import { progressAwareLoopGuardScenario } from './progress-aware-loop-guard.scenario';
import { appDisableScopeScenario } from './app-disable-scope.scenario';
import { confirmedMutationLeaseFinalizationScenario } from './confirmed-mutation-lease-finalization.scenario';
import { mcpProtocolSurfaceScenario } from './mcp-protocol-surface.scenario';
import { integrationHealthRetryScenario } from './integration-health-retry.scenario';
import { idempotencyTtlScenario } from './idempotency-ttl.scenario';
import {
  assertValidToolExchange,
  contextService,
  EmptyRecallRepository,
  entry,
  StaticConversationRepository,
} from './scenario-context-helpers';
import { browserInteractionPrimitivesScenario } from './browser-interaction-primitives.scenario';
import { suspendedSessionOwnershipScenario } from './suspended-session-ownership.scenario';
import { browserScreenshotVisionScenario } from './browser-screenshot-vision.scenario';
import { toolSurfaceProgressiveDisclosureScenario } from './tool-surface-progressive-disclosure.scenario';
import { machineRouteDependencyApprovalScenario } from './machine-route-dependency-approval.scenario';

interface ScenarioMetric {
  name: string;
  value: number;
  unit: string;
}

interface ScenarioResult {
  name: string;
  durationMs: number;
  metrics: ScenarioMetric[];
}

type Scenario = () => Promise<ScenarioMetric[]>;

class StaticProviderRepository implements ProviderRepositoryPort {
  constructor(private readonly provider: PersistedProviderView) {}

  async get(userId: number, providerId: string): Promise<PersistedProviderView | null> {
    return userId === 1 && providerId === this.provider.id ? this.provider : null;
  }

  async list(userId: number): Promise<PersistedProviderView[]> {
    return userId === 1 ? [this.provider] : [];
  }

  async create(_record: ProviderCreateRecord): Promise<PersistedProviderView> {
    throw new Error('SCENARIO_UNSUPPORTED');
  }

  async update(
    _userId: number,
    _providerId: string,
    _expectedVersion: number,
    _record: ProviderUpdateRecord,
  ): Promise<PersistedProviderView> {
    throw new Error('SCENARIO_UNSUPPORTED');
  }

  async replaceLiveCapabilities(
    userId: number,
    providerId: string,
    observations: ProviderModelCapabilityObservation[],
  ): Promise<void> {
    if (userId !== 1 || providerId !== this.provider.id) throw new Error('PROVIDER_NOT_FOUND');
    this.provider.liveCapabilities = observations.map((observation) => ({
      ...observation,
      capabilities: {
        ...observation.capabilities,
        ...(observation.capabilities.reasoning
          ? {
              reasoning: {
                ...observation.capabilities.reasoning,
                supportedEfforts: [...observation.capabilities.reasoning.supportedEfforts],
              },
            }
          : {}),
      },
    }));
  }

  async remove(_userId: number, _providerId: string, _expectedVersion: number, _deletedAt: number): Promise<void> {
    throw new Error('SCENARIO_UNSUPPORTED');
  }
}

class StaticProviderCatalogRepository implements ProviderRepositoryPort {
  constructor(private readonly providers: PersistedProviderView[]) {}

  async get(userId: number, providerId: string): Promise<PersistedProviderView | null> {
    return userId === 1 ? (this.providers.find((provider) => provider.id === providerId) ?? null) : null;
  }

  async list(userId: number): Promise<PersistedProviderView[]> {
    return userId === 1 ? this.providers : [];
  }

  async create(_record: ProviderCreateRecord): Promise<PersistedProviderView> {
    throw new Error('SCENARIO_UNSUPPORTED');
  }

  async update(
    _userId: number,
    _providerId: string,
    _expectedVersion: number,
    _record: ProviderUpdateRecord,
  ): Promise<PersistedProviderView> {
    throw new Error('SCENARIO_UNSUPPORTED');
  }

  async replaceLiveCapabilities(
    userId: number,
    providerId: string,
    observations: ProviderModelCapabilityObservation[],
  ): Promise<void> {
    const provider = userId === 1 ? this.providers.find((candidate) => candidate.id === providerId) : undefined;
    if (!provider) throw new Error('PROVIDER_NOT_FOUND');
    provider.liveCapabilities = observations.map((observation) => ({
      ...observation,
      capabilities: {
        ...observation.capabilities,
        ...(observation.capabilities.reasoning
          ? {
              reasoning: {
                ...observation.capabilities.reasoning,
                supportedEfforts: [...observation.capabilities.reasoning.supportedEfforts],
              },
            }
          : {}),
      },
    }));
  }

  async remove(_userId: number, _providerId: string, _expectedVersion: number, _deletedAt: number): Promise<void> {
    throw new Error('SCENARIO_UNSUPPORTED');
  }
}

interface ScriptedModelTurn {
  events: readonly ModelEvent[];
  assertRequest?: (request: ModelRequest) => void;
  error?: Error;
}

class ScriptedLanguageModel implements LanguageModelPort {
  readonly requests: ModelRequest[] = [];
  private cursor = 0;

  constructor(
    private readonly turns: readonly ScriptedModelTurn[],
    private readonly discoveries: readonly DiscoveredProviderModel[] = [],
  ) {}

  async discoverModels(_userId: number, _providerId: string, _signal: AbortSignal): Promise<DiscoveredProviderModel[]> {
    return this.discoveries.map((model) => ({
      ...model,
      ...(model.liveCapabilityReport
        ? {
            liveCapabilityReport: {
              ...model.liveCapabilityReport,
              capabilities: {
                ...model.liveCapabilityReport.capabilities,
                ...(model.liveCapabilityReport.capabilities.reasoning
                  ? {
                      reasoning: {
                        ...model.liveCapabilityReport.capabilities.reasoning,
                        supportedEfforts: [...model.liveCapabilityReport.capabilities.reasoning.supportedEfforts],
                      },
                    }
                  : {}),
              },
            },
          }
        : {}),
    }));
  }

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    if (signal.aborted) throw signal.reason ?? new Error('ABORTED');
    const turn = this.turns[this.cursor];
    assert.ok(turn, `unexpected model request at turn ${this.cursor + 1}`);
    this.cursor += 1;
    this.requests.push(request);
    turn.assertRequest?.(request);
    for (const event of turn.events) {
      if (signal.aborted) throw signal.reason ?? new Error('ABORTED');
      yield event;
    }
    if (turn.error) throw turn.error;
  }

  assertConsumed(): void {
    assert.equal(this.cursor, this.turns.length, 'all scripted model turns must be consumed');
  }
}

class ScenarioModelCallLimiter extends ModelCallLimiter {
  constructor() {
    super(null!);
  }

  override async acquire(_userId: number, signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) throw signal.reason ?? new Error('ABORTED');
    return () => undefined;
  }
}

const contextToolExchangeScenario: Scenario = async () => {
  const largeArguments = JSON.stringify({ path: '/workspace/work/example.ts', patch: 'x'.repeat(2_048) });
  const service = contextService([
    entry(1, 'user_input', { text: 'Inspect the repository and fix the issue.' }),
    entry(2, 'assistant_message', {
      text: '',
      toolCalls: [
        { id: 'call-a', name: 'file_read', argumentsJson: largeArguments },
        { id: 'call-b', name: 'file_search', argumentsJson: JSON.stringify({ query: 'needle' }) },
      ],
    }),
    entry(3, 'tool_result', { toolCallId: 'call-a', content: 'file contents '.repeat(24) }),
    entry(4, 'tool_result', { toolCallId: 'call-b', content: 'search result '.repeat(24) }),
    entry(5, 'assistant_message', { text: 'I found the relevant call sites.' }),
  ]);

  let compactedRuns = 0;
  for (const budget of [273, 320, 384, 512, 768, 1_024]) {
    const plan = await service.compose({
      scope,
      threadId: 'scenario-thread',
      runId: 'scenario-run',
      currentInput: 'Continue with the fix.',
      modelContextWindow: 4_096,
      maxContextTokens: budget,
      reservedOutputTokens: 128,
      maxRecallItems: 5,
      maxRecallBytes: 8_192,
      compactionMode: 'balanced',
      tools: [],
    });
    assertValidToolExchange(plan.messages);
    if (plan.compacted) compactedRuns += 1;
  }

  const fullPlan = await service.compose({
    scope,
    threadId: 'scenario-thread',
    runId: 'scenario-run',
    currentInput: 'Continue with the fix.',
    modelContextWindow: 8_192,
    maxContextTokens: 8_000,
    reservedOutputTokens: 128,
    maxRecallItems: 5,
    maxRecallBytes: 8_192,
    tools: [],
  });
  const assistantDiagnostic = fullPlan.messageDiagnostics.find(
    (diagnostic) => diagnostic.role === 'assistant' && diagnostic.estimatedTokens > 100,
  );
  assert.ok(assistantDiagnostic, 'structured tool-call arguments must contribute to token accounting');

  const historyEntries = [
    entry(1, 'user_input', { text: 'Historical request.' }, 'history-run'),
    entry(
      2,
      'assistant_message',
      {
        text: '',
        toolCalls: [
          { id: 'history-call-a', name: 'file_read', argumentsJson: '{"path":"a"}' },
          { id: 'history-call-b', name: 'file_search', argumentsJson: '{"query":"b"}' },
        ],
      },
      'history-run',
    ),
    entry(3, 'tool_result', { toolCallId: 'history-call-a', content: 'first terminal result' }, 'history-run'),
    entry(4, 'tool_result', { toolCallId: 'history-call-b', content: 'second terminal result' }, 'history-run'),
  ];
  for (const baseThrough of [2, 3]) {
    const boundaryPlan = await contextService(historyEntries).compose({
      scope,
      threadId: 'scenario-thread',
      runId: 'scenario-run',
      historyBoundary: { baseThrough, runThrough: {} },
      currentInput: 'Continue after the checkpoint.',
      modelContextWindow: 8_192,
      maxContextTokens: 8_000,
      reservedOutputTokens: 128,
      maxRecallItems: 5,
      maxRecallBytes: 8_192,
      tools: [],
    });
    assertValidToolExchange(boundaryPlan.messages);
    assert.ok(
      boundaryPlan.droppedSections.some((section) => section.startsWith('ledger-exchange-incomplete:')),
      'history boundary fragments must leave an explicit incomplete-exchange diagnostic',
    );
  }

  const pageBoundaryEntries = [
    entry(1, 'assistant_message', {
      text: '',
      toolCalls: [{ id: 'page-call', name: 'file_read', argumentsJson: '{"path":"old"}' }],
    }),
    entry(2, 'tool_result', { toolCallId: 'page-call', content: 'old terminal result' }),
    ...Array.from({ length: 159 }, (_, index) =>
      entry(index + 3, 'user_input', { text: `later ledger entry ${index + 1}` }),
    ),
  ];
  const pageBoundaryPlan = await contextService(pageBoundaryEntries).compose({
    scope,
    threadId: 'scenario-thread',
    runId: 'scenario-run',
    currentInput: 'Continue from the recent page.',
    modelContextWindow: 8_192,
    maxContextTokens: 8_000,
    reservedOutputTokens: 128,
    maxRecallItems: 5,
    maxRecallBytes: 8_192,
    tools: [],
  });
  assertValidToolExchange(pageBoundaryPlan.messages);
  assert.ok(
    pageBoundaryPlan.droppedSections.some((section) => section.startsWith('ledger-exchange-incomplete:')),
    'fixed-size page orphan fragments must leave an explicit incomplete-exchange diagnostic',
  );

  const terminalOutcomePlan = await contextService([
    entry(1, 'assistant_message', {
      text: '',
      toolCalls: [
        { id: 'denied-call', name: 'workspace_write', argumentsJson: '{}' },
        { id: 'expired-call', name: 'workspace_write', argumentsJson: '{}' },
        { id: 'superseded-call', name: 'workspace_write', argumentsJson: '{}' },
        { id: 'cancelled-call', name: 'workspace_write', argumentsJson: '{}' },
      ],
    }),
    entry(2, 'tool_result', {
      toolCallId: 'denied-call',
      text: JSON.stringify({ ok: false, outcome: 'confirmed', errorCode: 'APPROVAL_DENIED' }),
    }),
    entry(3, 'tool_result', {
      toolCallId: 'expired-call',
      text: JSON.stringify({ ok: false, outcome: 'confirmed', errorCode: 'APPROVAL_EXPIRED' }),
    }),
    entry(4, 'tool_result', {
      toolCallId: 'superseded-call',
      text: JSON.stringify({ ok: false, outcome: 'confirmed', errorCode: 'APPROVAL_SUPERSEDED' }),
    }),
    entry(5, 'tool_result', {
      toolCallId: 'cancelled-call',
      text: JSON.stringify({ ok: false, outcome: 'confirmed', errorCode: 'RUN_CANCELLED_BEFORE_TOOL_EXECUTION' }),
    }),
  ]).compose({
    scope,
    threadId: 'scenario-thread',
    runId: 'scenario-run',
    currentInput: 'Continue after terminal tool outcomes.',
    modelContextWindow: 8_192,
    maxContextTokens: 8_000,
    reservedOutputTokens: 128,
    maxRecallItems: 5,
    maxRecallBytes: 8_192,
    tools: [],
  });
  assertValidToolExchange(terminalOutcomePlan.messages);
  assert.equal(
    terminalOutcomePlan.messages.filter((message) => message.role === 'tool').length,
    4,
    'denied/expired/superseded/cancelled canonical tool results must remain in the assistant batch',
  );

  const reusedToolCallId = 'provider-reused-tool-call-id';
  const reusedToolCallPlan = await contextService([
    entry(1, 'user_input', { text: 'Load the historical Skill.' }, 'history-run'),
    entry(
      2,
      'assistant_message',
      {
        text: '',
        toolCalls: [{ id: reusedToolCallId, name: 'skill_read', argumentsJson: '{"id":"nexus.agent.developer"}' }],
      },
      'history-run',
    ),
    entry(3, 'tool_result', { toolCallId: reusedToolCallId, content: 'historical Skill body' }, 'history-run'),
    entry(4, 'assistant_message', { text: 'Historical Skill loaded.' }, 'history-run'),
    entry(5, 'user_input', { text: 'Continue from the compacted thread.' }, 'current-run'),
    entry(
      6,
      'assistant_message',
      {
        text: '',
        toolCalls: [{ id: reusedToolCallId, name: 'skill_read', argumentsJson: '{"id":"nexus.agent.developer"}' }],
      },
      'current-run',
    ),
    entry(7, 'tool_result', { toolCallId: reusedToolCallId, content: 'current Skill body' }, 'current-run'),
  ]).compose({
    scope,
    threadId: 'scenario-thread',
    runId: 'current-run',
    currentInput: 'Continue from the compacted thread.',
    currentInputEntryId: 'entry-5',
    modelContextWindow: 8_192,
    maxContextTokens: 8_000,
    reservedOutputTokens: 128,
    maxRecallItems: 5,
    maxRecallBytes: 8_192,
    tools: [],
  });
  assertValidToolExchange(reusedToolCallPlan.messages);
  assert.equal(
    reusedToolCallPlan.messages.filter((message) => message.role === 'tool' && message.toolCallId === reusedToolCallId)
      .length,
    2,
    'reused provider Tool call ids must bind to the nearest unsettled assistant exchange instead of becoming ambiguous',
  );
  assert.ok(
    !reusedToolCallPlan.droppedSections.some((section) => section.startsWith('ledger-exchange-incomplete:')),
    'reusing a Tool call id in a later Run must not invalidate either complete exchange',
  );

  return [
    { name: 'budget_variants', value: 6, unit: 'cases' },
    { name: 'compacted_variants', value: compactedRuns, unit: 'cases' },
    { name: 'tool_argument_estimate', value: assistantDiagnostic.estimatedTokens, unit: 'tokens' },
    { name: 'boundary_fragment_cases', value: 3, unit: 'cases' },
    { name: 'terminal_outcome_variants', value: 4, unit: 'cases' },
    { name: 'reused_tool_call_id_exchanges', value: 2, unit: 'exchanges' },
  ];
};

const durableContextCheckpointScenario: Scenario = async () => {
  const history: LedgerEntryView[] = [
    entry(1, 'user_input', { text: 'Project objective: repair the parser without changing generated files.' }),
    entry(2, 'assistant_message', { text: 'Confirmed the repository constraint and started inspection.' }),
    entry(3, 'assistant_message', {
      text: 'FAILED ATTEMPT: the XML patch approach was ruled out because it corrupts source maps. Never retry XML patch.',
    }),
  ];
  for (let sequence = 4; sequence <= 210; sequence += 1) {
    history.push(
      entry(sequence, sequence % 2 === 0 ? 'user_input' : 'assistant_message', {
        text:
          sequence % 2 === 0
            ? `Routine historical request ${sequence}: inspect the parser state and continue safely. ${'history '.repeat(18)}`
            : `Routine historical response ${sequence}: inspected the parser state. ${'analysis '.repeat(18)}`,
      }),
    );
  }
  const service = contextService(history);
  const plan = await service.compose({
    scope,
    threadId: 'scenario-thread',
    runId: 'scenario-run',
    currentInput: 'Proceed with the next implementation step.',
    goal: 'GOAL_MARKER: preserve parser correctness and generated-file immutability.',
    taskPlan: 'PLAN_MARKER: inspect, patch source only, run deterministic verification.',
    collaborationContext: 'COLLAB_MARKER: child parser audit completed; no active child work remains.',
    modelContextWindow: 4_096,
    maxContextTokens: 1_050,
    reservedOutputTokens: 256,
    maxRecallItems: 5,
    maxRecallBytes: 8_192,
    compactionMode: 'balanced',
    tools: [],
  });
  assert.equal(plan.compacted, true, 'fixture must trigger history compaction');
  assert.ok(
    plan.tokenDiagnostics.summaryCheckpointTokens > 0,
    'compaction must project a durable verified Context checkpoint instead of only dropping old raw Ledger',
  );
  const encoded = JSON.stringify(plan.messages);
  assert.match(
    encoded,
    /XML patch approach was ruled out/,
    'derived checkpoint must retain failed\/ruled-out attempts outside the recent verbatim tail',
  );
  assert.match(encoded, /GOAL_MARKER/, 'current Goal must be reserved ahead of raw history');
  assert.match(encoded, /PLAN_MARKER/, 'current Plan must be reserved ahead of raw history');
  assert.match(encoded, /COLLAB_MARKER/, 'current Collaboration state must be reserved ahead of raw history');
  const checkpointSource = plan.sourceRanges.find((source) => source.kind === 'summary_checkpoint');
  assert.match(
    checkpointSource?.hash ?? '',
    /^[a-f0-9]{64}$/,
    'Context lineage must include the verified checkpoint source hash so regenerated summaries change contextEpoch',
  );
  assertValidToolExchange(plan.messages);

  const fallbackRepository = new StaticConversationRepository(history);
  const fallbackConversations = new ConversationService(fallbackRepository, clock, null!, null!);
  const failingCheckpoints = new ContextCheckpointService(
    {
      getExact: async () => {
        throw new Error('CHECKPOINT_STORE_UNAVAILABLE');
      },
      upsert: async () => {
        throw new Error('CHECKPOINT_STORE_UNAVAILABLE');
      },
    },
    fallbackConversations,
    clock,
  );
  const fallbackContext = new ContextService(
    fallbackConversations,
    new RecallService(new EmptyRecallRepository(), clock),
    new SkillRegistry(),
    emptyModelContinuations,
    null!,
    failingCheckpoints,
  );
  const fallbackPlan = await fallbackContext.compose({
    scope,
    threadId: 'scenario-thread',
    runId: 'scenario-run',
    currentInput: 'Proceed despite a checkpoint persistence failure.',
    goal: 'GOAL_MARKER: preserve parser correctness and generated-file immutability.',
    taskPlan: 'PLAN_MARKER: inspect, patch source only, run deterministic verification.',
    collaborationContext: 'COLLAB_MARKER: child parser audit completed; no active child work remains.',
    modelContextWindow: 4_096,
    maxContextTokens: 1_050,
    reservedOutputTokens: 256,
    maxRecallItems: 5,
    maxRecallBytes: 8_192,
    compactionMode: 'balanced',
    tools: [],
  });
  assert.equal(fallbackPlan.compacted, true);
  assert.equal(
    fallbackPlan.tokenDiagnostics.summaryCheckpointTokens,
    0,
    'checkpoint failure must fall back to drop-only projection instead of fabricating derived state',
  );
  assert.ok(
    fallbackPlan.droppedSections.includes('summary-checkpoint:unavailable'),
    'checkpoint failure must be observable without blocking model execution',
  );
  assertValidToolExchange(fallbackPlan.messages);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-context-checkpoint-schema-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'context-checkpoint.sqlite', nodeEnv: 'test' });
  try {
    await db.initialize();
    const checkpointTable = await db.queryOne<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ai_context_checkpoints'",
    );
    assert.equal(
      checkpointTable?.name,
      'ai_context_checkpoints',
      'fresh schema must expose the single Context checkpoint owner',
    );
    const legacyDigest = await db.queryOne<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ai_context_digests'",
    );
    assert.equal(legacyDigest, null, 'legacy ai_context_digests dead owner must be removed');

    await db.execute(
      "INSERT INTO users (id, username, hashed_password) VALUES (1, 'context-checkpoint-user', 'not-used')",
    );
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
       VALUES (1, 'scenario-app', '1.0.0', 'enabled', 'running', 0, ?, ?)`,
      [clock.nowUnixSeconds(), clock.nowUnixSeconds()],
    );
    const durableConversationsRepository = new SqliteConversationRepository(db);
    await durableConversationsRepository.createThread(
      scope,
      'context-checkpoint-thread',
      'Context checkpoint fixture',
      'manual',
      clock.nowUnixSeconds(),
    );
    await durableConversationsRepository.appendEntry(scope, 'context-checkpoint-thread', {
      id: 'context-checkpoint-entry-1',
      kind: 'user_input',
      payload: { text: 'Keep the durable constraint marker.' },
      createdAt: clock.nowUnixSeconds(),
    });
    await durableConversationsRepository.appendEntry(scope, 'context-checkpoint-thread', {
      id: 'context-checkpoint-entry-2',
      kind: 'assistant_message',
      payload: { text: 'FAILED ATTEMPT STALE_SOURCE_MARKER: remove this source and never reuse its derived summary.' },
      createdAt: clock.nowUnixSeconds() + 1,
    });
    await durableConversationsRepository.appendEntry(scope, 'context-checkpoint-thread', {
      id: 'context-checkpoint-entry-3',
      kind: 'assistant_message',
      payload: { text: 'Current state remains safe and resumable.' },
      createdAt: clock.nowUnixSeconds() + 2,
    });
    const durableConversations = new ConversationService(durableConversationsRepository, clock, null!, null!);
    const durableCheckpointRepository = new SqliteContextCheckpointRepository(db);
    const durableCheckpoints = new ContextCheckpointService(durableCheckpointRepository, durableConversations, clock);
    const firstCheckpoint = await durableCheckpoints.checkpointForPrefix({
      scope,
      threadId: 'context-checkpoint-thread',
      throughSequence: 3,
      maxSummaryTokens: 512,
      hardPressure: true,
    });
    assert.ok(firstCheckpoint, 'Context checkpoint producer must persist a derived summary');
    assert.match(firstCheckpoint!.content, /STALE_SOURCE_MARKER/);
    const reusedCheckpoint = await durableCheckpoints.checkpointForPrefix({
      scope,
      threadId: 'context-checkpoint-thread',
      throughSequence: 3,
      maxSummaryTokens: 512,
      hardPressure: true,
    });
    assert.equal(
      reusedCheckpoint?.id,
      firstCheckpoint!.id,
      'unchanged canonical source must reuse the durable checkpoint',
    );
    const persistedCount = await db.queryOne<{ count: number }>(
      "SELECT COUNT(*) AS count FROM ai_context_checkpoints WHERE thread_id = 'context-checkpoint-thread'",
    );
    assert.equal(
      persistedCount?.count,
      1,
      'checkpoint producer/consumer must round-trip through the single durable table',
    );

    await db.execute("DELETE FROM ai_thread_entries WHERE id = 'context-checkpoint-entry-2'");
    const refreshedCheckpoint = await durableCheckpoints.checkpointForPrefix({
      scope,
      threadId: 'context-checkpoint-thread',
      throughSequence: 3,
      maxSummaryTokens: 512,
      hardPressure: true,
    });
    assert.ok(refreshedCheckpoint);
    assert.notEqual(
      refreshedCheckpoint!.sourceHash,
      firstCheckpoint!.sourceHash,
      'source hash mismatch must invalidate stale derived Context state',
    );
    assert.doesNotMatch(
      refreshedCheckpoint!.content,
      /STALE_SOURCE_MARKER/,
      'regenerated checkpoint must derive only from the current canonical Ledger source',
    );
    const resumedBoundaryCheckpoint = await durableCheckpoints.checkpointForPrefix({
      scope,
      threadId: 'context-checkpoint-thread',
      runId: 'resumed-run',
      historyBoundary: { baseThrough: 3, runThrough: {} },
      throughSequence: 3,
      maxSummaryTokens: 512,
      hardPressure: true,
    });
    assert.ok(resumedBoundaryCheckpoint);
    assert.equal(
      resumedBoundaryCheckpoint!.visibility.kind,
      'run_boundary',
      'checkpoint resume visibility must remain explicit durable metadata',
    );
    assert.notEqual(
      resumedBoundaryCheckpoint!.id,
      refreshedCheckpoint!.id,
      'a resumed Run boundary must not reuse a Thread-prefix checkpoint under a different visibility contract',
    );
  } finally {
    await db.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }

  const upgradeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-context-checkpoint-upgrade-'));
  const legacyDb = new DatabaseSync(path.join(upgradeDirectory, 'context-checkpoint-upgrade.sqlite'));
  try {
    legacyDb.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
      INSERT INTO migrations (id, name, applied_at) VALUES (29, 'legacy baseline', 1800000000);
      CREATE TABLE ai_threads (id TEXT PRIMARY KEY);
      CREATE TABLE ai_context_digests (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES ai_threads(id) ON DELETE CASCADE,
        from_sequence INTEGER NOT NULL,
        to_sequence INTEGER NOT NULL CHECK(to_sequence >= from_sequence),
        source_hash TEXT NOT NULL,
        model_config_version TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    await runMigrations(legacyDb);
    const upgradedCheckpoint = legacyDb
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ai_context_checkpoints'")
      .get() as { name?: string } | undefined;
    const upgradedLegacyDigest = legacyDb
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ai_context_digests'")
      .get() as { name?: string } | undefined;
    const migrationVersion = legacyDb.prepare('SELECT MAX(id) AS version FROM migrations').get() as
      { version?: number } | undefined;
    assert.equal(
      upgradedCheckpoint?.name,
      'ai_context_checkpoints',
      'migration 30 must create the Context checkpoint owner',
    );
    assert.equal(upgradedLegacyDigest, undefined, 'migration 30 must drop the dead ai_context_digests table');
    assert.equal(migrationVersion?.version, 45, 'legacy databases must advance through migration 45');
  } finally {
    legacyDb.close();
    fs.rmSync(upgradeDirectory, { recursive: true, force: true });
  }

  return [
    { name: 'summary_checkpoint_tokens', value: plan.tokenDiagnostics.summaryCheckpointTokens, unit: 'tokens' },
    { name: 'visible_context_messages', value: plan.messages.length, unit: 'messages' },
    { name: 'checkpoint_failure_fallbacks', value: 1, unit: 'cases' },
    { name: 'durable_checkpoint_roundtrips', value: 1, unit: 'cases' },
    { name: 'stale_source_regenerations', value: 1, unit: 'cases' },
    { name: 'upgrade_migration_cases', value: 1, unit: 'cases' },
    { name: 'legacy_digest_tables', value: 0, unit: 'tables' },
    { name: 'migration_version', value: 45, unit: 'version' },
  ];
};

const legacyMachineInspectionMigrationScenario: Scenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-legacy-machine-inspection-'));
  const db = new DatabaseSync(path.join(directory, 'legacy-machine-inspection.sqlite'));
  const legacyInspection = {
    toolName: 'machine_execute_shell',
    toolVersion: '1.0.0',
    normalizedArguments: { connectionId: 42, command: 'pwd' },
    target: {
      kind: 'machine',
      targetIdentity: 'ssh:42',
      endpoint: 'scenario-host:22',
      loginUser: 'scenario-user',
      configurationHash: 'scenario-config',
      connectionId: 42,
    },
    resourceKeys: ['ssh:42'],
    risk: 'mutate',
    mutation: true,
    operationHash: 'scenario-operation-hash',
    operationHashVersion: 1,
    preconditions: [],
    policyRevision: 1,
    inputRevision: 1,
  };
  try {
    assert.throws(() => parseToolInspection(JSON.stringify(legacyInspection)), /AGENT_DURABLE_STATE_INVALID/);
    db.exec(`
      CREATE TABLE migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
      INSERT INTO migrations (id, name, applied_at) VALUES (44, 'pre-machine-inspection-canonicalization', 1800000000);
      CREATE TABLE agent_tool_calls (
        id TEXT PRIMARY KEY,
        inspection_json TEXT NOT NULL
      );
      CREATE TABLE agent_approvals (
        id TEXT PRIMARY KEY,
        inspection_json TEXT
      );
    `);
    db.prepare('INSERT INTO agent_tool_calls (id, inspection_json) VALUES (?, ?)').run(
      'legacy-tool',
      JSON.stringify(legacyInspection),
    );
    db.prepare('INSERT INTO agent_approvals (id, inspection_json) VALUES (?, ?)').run(
      'legacy-approval',
      JSON.stringify(legacyInspection),
    );

    await runMigrations(db);

    const toolRow = db.prepare("SELECT inspection_json FROM agent_tool_calls WHERE id = 'legacy-tool'").get() as {
      inspection_json: string;
    };
    const approvalRow = db
      .prepare("SELECT inspection_json FROM agent_approvals WHERE id = 'legacy-approval'")
      .get() as {
      inspection_json: string;
    };
    for (const raw of [toolRow.inspection_json, approvalRow.inspection_json]) {
      const inspection = parseToolInspection(raw);
      assert.equal(inspection.target.kind, 'ssh');
      assert.equal(inspection.target.target, 'ssh');
      assert.equal(inspection.target.id, '42');
      assert.equal(inspection.target.connectionId, 42);
    }
    const legacyRows = db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM agent_tool_calls WHERE json_extract(inspection_json, '$.target.kind') = 'machine') +
          (SELECT COUNT(*) FROM agent_approvals WHERE json_extract(inspection_json, '$.target.kind') = 'machine') AS count`,
      )
      .get() as { count: number };
    assert.equal(legacyRows.count, 0, 'migration 45 must remove decodable legacy machine inspection targets');
    const version = db.prepare('SELECT MAX(id) AS version FROM migrations').get() as { version: number };
    assert.equal(version.version, 45);

    return [
      { name: 'legacy_machine_inspections_migrated', value: 2, unit: 'rows' },
      { name: 'legacy_machine_inspections_remaining', value: legacyRows.count, unit: 'rows' },
      { name: 'migration_version', value: version.version, unit: 'version' },
    ];
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

const capabilityGrantMigrationScenario: Scenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-capability-grant-migration-'));
  const db = new DatabaseSync(path.join(directory, 'grant-migration.sqlite'));
  try {
    db.exec(`
      CREATE TABLE migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
      INSERT INTO migrations (id, name, applied_at) VALUES (34, 'pre-capability-v2', 1800000000);

      CREATE TABLE agent_app_grants (
        user_id INTEGER NOT NULL,
        app_id TEXT NOT NULL,
        capability TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        scope_json TEXT NOT NULL,
        granted_at INTEGER NOT NULL,
        PRIMARY KEY(user_id, app_id, capability)
      );
      INSERT INTO agent_app_grants VALUES
        (1, 'workspace-only', 'workspace.read', 1, '{"targetSelection":"all-except-denylist"}', 10),
        (1, 'ssh-only', 'machine.files.read', 1, '{"targetSelection":"all-except-denylist"}', 11),
        (1, 'both', 'workspace.read', 1, '{"targetSelection":"all-except-denylist"}', 12),
        (1, 'both', 'machine.files.read', 1, '{"targetSelection":"all-except-denylist"}', 13),
        (1, 'workspace-write', 'workspace.write', 1, '{"targetSelection":"all-except-denylist"}', 14),
        (1, 'global', 'artifacts.read', 1, '{}', 15),
        (1, 'workspace-shell', 'workspace.execute', 1, '{}', 16),
        (1, 'ssh-shell', 'machine.shell.execute', 1, '{}', 17),
        (1, 'both-shell', 'workspace.execute', 1, '{}', 18),
        (1, 'both-shell', 'machine.shell.execute', 1, '{}', 19);

      CREATE TABLE agent_delegations (
        id TEXT PRIMARY KEY,
        capabilities_json TEXT NOT NULL
      );
      INSERT INTO agent_delegations VALUES (
        'legacy-delegation',
        '["workspace.read","machine.files.read","workspace.write","workspace.execute","machine.shell.execute","artifacts.read"]'
      );

      CREATE TABLE agent_plugin_versions (
        app_id TEXT NOT NULL,
        version TEXT NOT NULL,
        manifest_json TEXT NOT NULL
      );
      INSERT INTO agent_plugin_versions VALUES (
        'legacy.plugin',
        '1.0.0',
        '{"capabilities":["workspace.read","machine.files.write","workspace.execute","machine.shell.execute","artifacts.read"]}'
      );

      CREATE TABLE agent_plugin_stages (
        id TEXT PRIMARY KEY,
        manifest_json TEXT
      );
      INSERT INTO agent_plugin_stages VALUES (
        'legacy-stage',
        '{"capabilities":["machine.files.read","workspace.write","workspace.execute"]}'
      );

      CREATE TABLE agent_tool_calls (
        id TEXT PRIMARY KEY,
        tool_name TEXT NOT NULL,
        inspection_json TEXT NOT NULL,
        result_json TEXT
      );
      INSERT INTO agent_tool_calls VALUES (
        'legacy-workspace-shell',
        'workspace_execute_argv',
        '{"normalizedArguments":{"workspaceId":"legacy-workspace","generation":7},"target":{"kind":"workspace","target":"workspace","id":"legacy-workspace"}}',
        '{"ok":true,"summary":"accepted","data":{"jobId":"job-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","workspaceId":"legacy-workspace","generation":7,"status":"running"},"artifactRefs":[],"truncated":false,"outcome":"confirmed","verification":{"status":"unverified","summary":"pending","evidenceRefs":[]}}'
      );
      INSERT INTO agent_tool_calls VALUES (
        'legacy-ssh-shell',
        'machine_execute_shell',
        '{"normalizedArguments":{"connectionId":42},"target":{"kind":"ssh","target":"ssh","id":"42"}}',
        '{"ok":true,"summary":"done","data":{"exitCode":0},"artifactRefs":[],"truncated":false,"outcome":"confirmed","verification":{"status":"verified","summary":"done","evidenceRefs":[]}}'
      );
    `);

    await runMigrations(db);

    const grants = db
      .prepare(
        'SELECT app_id, capability, schema_version, scope_json FROM agent_app_grants ORDER BY app_id, capability',
      )
      .all() as Array<{ app_id: string; capability: string; schema_version: number; scope_json: string }>;
    assert.equal(
      grants.every((grant) => grant.schema_version === 2),
      true,
    );
    const scopeFor = (appId: string, capability: string): JsonValue => {
      const row = grants.find((grant) => grant.app_id === appId && grant.capability === capability);
      assert.ok(row, `missing migrated grant ${appId}/${capability}`);
      return JSON.parse(row.scope_json) as JsonValue;
    };
    assert.deepEqual(scopeFor('workspace-only', 'file.read'), {
      kind: 'targets',
      targets: { workspace: { mode: 'all' } },
    });
    assert.deepEqual(scopeFor('ssh-only', 'file.read'), {
      kind: 'targets',
      targets: { ssh: { mode: 'all' } },
    });
    assert.deepEqual(scopeFor('both', 'file.read'), {
      kind: 'targets',
      targets: { workspace: { mode: 'all' }, ssh: { mode: 'all' } },
    });
    assert.deepEqual(scopeFor('workspace-write', 'file.write'), {
      kind: 'targets',
      targets: { workspace: { mode: 'all' } },
    });
    assert.deepEqual(scopeFor('global', 'artifacts.read'), { kind: 'global' });
    assert.deepEqual(scopeFor('workspace-shell', 'shell.execute'), {
      kind: 'targets',
      targets: { workspace: { mode: 'all' } },
    });
    assert.deepEqual(scopeFor('ssh-shell', 'shell.execute'), {
      kind: 'targets',
      targets: { ssh: { mode: 'all' } },
    });
    assert.deepEqual(scopeFor('both-shell', 'shell.execute'), {
      kind: 'targets',
      targets: { workspace: { mode: 'all' }, ssh: { mode: 'all' } },
    });

    const delegation = db.prepare("SELECT grants_json FROM agent_delegations WHERE id='legacy-delegation'").get() as {
      grants_json: string;
    };
    const delegatedGrants = JSON.parse(delegation.grants_json) as Array<{
      capability: string;
      schemaVersion: number;
      scope: JsonValue;
    }>;
    assert.deepEqual(
      delegatedGrants.map((grant) => grant.capability).sort(),
      ['artifacts.read', 'file.read', 'file.write', 'shell.execute'],
      'legacy Subagent file/shell authorities must collapse to canonical delegated capabilities',
    );
    for (const grant of delegatedGrants.filter((candidate) => candidate.capability.startsWith('file.'))) {
      assert.equal(grant.schemaVersion, 2);
      assert.deepEqual(grant.scope, {
        kind: 'targets',
        targets: { workspace: { mode: 'all' } },
      });
    }
    const delegatedShell = delegatedGrants.find((grant) => grant.capability === 'shell.execute');
    assert.ok(delegatedShell);
    assert.equal(delegatedShell.schemaVersion, 2);
    assert.deepEqual(delegatedShell.scope, {
      kind: 'targets',
      targets: { workspace: { mode: 'all' }, ssh: { mode: 'all' } },
    });

    const versionManifest = JSON.parse(
      (
        db.prepare("SELECT manifest_json FROM agent_plugin_versions WHERE app_id='legacy.plugin'").get() as {
          manifest_json: string;
        }
      ).manifest_json,
    ) as { capabilities: string[] };
    assert.deepEqual(versionManifest.capabilities, ['artifacts.read', 'file.read', 'file.write', 'shell.execute']);
    const stageManifest = JSON.parse(
      (
        db.prepare("SELECT manifest_json FROM agent_plugin_stages WHERE id='legacy-stage'").get() as {
          manifest_json: string;
        }
      ).manifest_json,
    ) as { capabilities: string[] };
    assert.deepEqual(stageManifest.capabilities, ['file.read', 'file.write', 'shell.execute']);

    const migratedWorkspaceResult = JSON.parse(
      (
        db.prepare("SELECT result_json FROM agent_tool_calls WHERE id='legacy-workspace-shell'").get() as {
          result_json: string;
        }
      ).result_json,
    ) as ToolResult;
    assert.deepEqual(migratedWorkspaceResult.semantic, {
      kind: 'execution',
      target: { target: 'workspace', id: 'legacy-workspace' },
      status: 'running',
      job: {
        jobId: 'job-' + 'a'.repeat(64),
        workspaceId: 'legacy-workspace',
        generation: 7,
      },
    });
    const migratedSshResult = JSON.parse(
      (
        db.prepare("SELECT result_json FROM agent_tool_calls WHERE id='legacy-ssh-shell'").get() as {
          result_json: string;
        }
      ).result_json,
    ) as ToolResult;
    assert.deepEqual(migratedSshResult.semantic, {
      kind: 'execution',
      target: { target: 'ssh', id: '42' },
      status: 'succeeded',
    });

    return [
      { name: 'capability_grant_migration_schema_version', value: 2, unit: 'version' },
      { name: 'capability_grant_migration_workspace_only', value: 1, unit: 'cases' },
      { name: 'capability_grant_migration_ssh_only', value: 1, unit: 'cases' },
      { name: 'capability_grant_migration_shell_workspace_only', value: 1, unit: 'cases' },
      { name: 'capability_grant_migration_shell_ssh_only', value: 1, unit: 'cases' },
      { name: 'capability_grant_migration_shell_combined', value: 1, unit: 'cases' },
      { name: 'capability_grant_migration_execution_semantics', value: 2, unit: 'results' },
      { name: 'capability_grant_migration_widened_scopes', value: 0, unit: 'cases' },
    ];
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

const projectInstructionsContextScenario: Scenario = async () => {
  const service = contextService([]);
  const baseInput = {
    scope,
    threadId: 'scenario-thread',
    runId: 'scenario-run',
    currentInput: 'Update src/parser/index.ts and follow the repository rules.',
    modelContextWindow: 8_192,
    maxContextTokens: 8_000,
    reservedOutputTokens: 256,
    maxRecallItems: 5,
    maxRecallBytes: 8_192,
    tools: [],
  } as const;
  const withoutProject = await service.compose(baseInput);
  const withProject = await service.compose({
    ...baseInput,
    projectInstructions: [
      {
        path: '/workspace/work/AGENTS.md',
        scopePath: '/workspace/work',
        projectRoot: '/workspace/work',
        hash: 'a'.repeat(64),
        content: 'ROOT_RULE_MARKER: run tests before finishing.',
        sourceBytes: 44,
        contentBytes: 44,
        truncated: false,
        provenance: 'workspace',
      },
      {
        path: '/workspace/work/src/parser/AGENTS.md',
        scopePath: '/workspace/work/src/parser',
        projectRoot: '/workspace/work',
        hash: 'b'.repeat(64),
        content: 'NESTED_RULE_MARKER: generated parser files are immutable.',
        sourceBytes: 57,
        contentBytes: 57,
        truncated: false,
        provenance: 'workspace',
      },
    ],
  });

  const encoded = withProject.instructions.join('\n');
  assert.match(encoded, /ROOT_RULE_MARKER/, 'repo-root AGENTS.md must enter the stable model instruction prefix');
  assert.match(
    encoded,
    /NESTED_RULE_MARKER/,
    'matching nested AGENTS.md must enter the stable model instruction prefix after root rules',
  );
  assert.ok(
    encoded.indexOf('ROOT_RULE_MARKER') < encoded.indexOf('NESTED_RULE_MARKER'),
    'deeper project instructions must be ordered after broader root instructions',
  );
  assert.notEqual(
    withProject.stablePrefixHash,
    withoutProject.stablePrefixHash,
    'project instruction content must naturally participate in stablePrefixHash and P-081 cache lineage',
  );
  assert.ok(
    withProject.tokenDiagnostics.projectInstructionTokens > 0,
    'project instruction tokens must be first-class Context telemetry',
  );
  assert.equal(
    withProject.sourceRanges.filter((source) => source.kind === 'project_instruction').length,
    2,
    'project instruction provenance must be visible in Context source ranges',
  );

  const httpDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-project-instructions-http-'));
  let httpCodecCases = 0;
  let generationConflictCases = 0;
  let runnerServer: ReturnType<RunnerControllerServer['createServer']> | null = null;
  try {
    const journal = new RunnerJournal(path.join(httpDirectory, 'journal.json'));
    journal.saveWorkspace({
      workspaceId: 'scenario-workspace',
      generation: 7,
      status: 'running',
      retained: false,
      toolchain: [],
      runnerPlugins: [],
      acpProfiles: [],
      browserTarget: null,
    });
    runnerServer = new RunnerControllerServer({
      token: 'scenario-token',
      journal,
      runtimeEngine: {
        projectInstructions: (workspaceId: string, generation: number, targetDirectories: readonly string[]) => {
          assert.equal(workspaceId, 'scenario-workspace');
          assert.equal(generation, 7);
          return {
            targetDirectories: [...targetDirectories],
            instructions: [
              {
                path: '/workspace/work/AGENTS.md',
                scopePath: '/workspace/work',
                projectRoot: '/workspace/work',
                hash: 'c'.repeat(64),
                content: 'HTTP_CODEC_RULE',
                sourceBytes: 15,
                contentBytes: 15,
                truncated: false,
                provenance: 'workspace' as const,
              },
            ],
            omitted: [],
          };
        },
      },
      catalog: {},
      installer: {},
      storage: {},
      cleanup: {},
      pluginRunner: {},
      acpRuntime: { closeAll: () => undefined },
      terminalRuntime: { closeAll: () => undefined },
      browserTunnel: { closeAll: () => undefined },
    } as unknown as ConstructorParameters<typeof RunnerControllerServer>[0]).createServer();
    const baseUrl = await new Promise<string>((resolve, reject) => {
      runnerServer!.once('error', reject);
      runnerServer!.listen(0, '127.0.0.1', () => {
        const address = runnerServer!.address();
        if (!address || typeof address === 'string') {
          reject(new Error('SCENARIO_RUNNER_ADDRESS_INVALID'));
          return;
        }
        resolve(`http://127.0.0.1:${address.port}`);
      });
    });
    const runnerAdapter = new RunnerHttpAdapter(baseUrl, 'scenario-token');
    const httpProjection = await runnerAdapter.projectInstructions('scenario-workspace', 7, [
      '/workspace/work/src/parser',
    ]);
    assert.deepEqual(httpProjection.targetDirectories, ['/workspace/work/src/parser']);
    assert.equal(httpProjection.instructions[0]?.content, 'HTTP_CODEC_RULE');
    httpCodecCases += 1;

    const invalidCodecResponse = await fetch(`${baseUrl}/v1/workspaces/scenario-workspace/project-instructions`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer scenario-token',
        'Content-Type': 'application/json',
        'X-Nexus-Agent-Protocol': '2026-09-13',
      },
      body: JSON.stringify({
        generation: 7,
        targetDirectories: ['/workspace/work'],
        unexpected: true,
      }),
    });
    assert.equal(invalidCodecResponse.status, 400, 'Runner project-instruction codec must reject unknown fields');
    httpCodecCases += 1;

    await assert.rejects(
      () => runnerAdapter.projectInstructions('scenario-workspace', 6, ['/workspace/work']),
      /WORKSPACE_GENERATION_CONFLICT/,
      'Runner generation conflicts must survive the Backend HTTP adapter as a stable error code',
    );
    generationConflictCases += 1;
  } finally {
    if (runnerServer) {
      await new Promise<void>((resolve, reject) => runnerServer!.close((error) => (error ? reject(error) : resolve())));
    }
    fs.rmSync(httpDirectory, { recursive: true, force: true });
  }

  const auditBenchmark: AgentBenchmarkCase = {
    id: 'project-instruction-audit',
    prompt: 'Inspect the working subtree.',
    toolName: 'scenario_noop',
    toolArgumentsJson: '{}',
    toolDescription: 'No-op scenario tool.',
    toolInputSchema: { type: 'object', additionalProperties: false },
    toolSummary: 'noop',
    finalText: 'done',
    usage: [
      { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
      { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
    ],
  };
  const auditSnapshot = benchmarkSnapshot(auditBenchmark, scope);
  auditSnapshot.definition = {
    ...auditSnapshot.definition,
    environment: {
      kind: 'code',
      recipeId: 'scenario-code',
      recipeRevision: '1',
      runtimeDigest: 'scenario-runtime',
      catalogRevision: 'scenario-catalog',
      toolchain: [],
      runnerPlugins: [],
      acpProfiles: [],
      browserTarget: null,
    },
  };
  auditSnapshot.recentEntries = [
    ...auditSnapshot.recentEntries,
    {
      id: 'project-instruction-audit-tool-calls',
      sequence: 2,
      kind: 'assistant_message',
      payload: {
        text: '',
        toolCalls: [
          {
            id: 'valid-cwd',
            name: 'shell_execute',
            argumentsJson: JSON.stringify({
              target: 'workspace',
              id: 'workspace-audit',
              command: { kind: 'argv', argv: ['pwd'] },
              cwd: '/workspace/work/src/parser',
            }),
          },
          {
            id: 'outside-cwd',
            name: 'shell_execute',
            argumentsJson: JSON.stringify({
              target: 'workspace',
              id: 'workspace-audit',
              command: { kind: 'argv', argv: ['pwd'] },
              cwd: '/workspace/work/../outside',
            }),
          },
          {
            id: 'read-target',
            name: 'file_read',
            argumentsJson: JSON.stringify({
              target: 'workspace',
              id: 'workspace-audit',
              path: '/workspace/work/packages/api/src/index.ts',
            }),
          },
          {
            id: 'search-target',
            name: 'file_search',
            argumentsJson: JSON.stringify({
              target: 'workspace',
              id: 'workspace-audit',
              path: '/workspace/work/packages/web',
            }),
          },
          {
            id: 'patch-target',
            name: 'file_patch',
            argumentsJson: JSON.stringify({
              target: 'workspace',
              id: 'workspace-audit',
              expectedFiles: [
                { path: 'packages/core/src/a.ts', sha256: 'a'.repeat(64) },
                { path: '/workspace/work/../../outside.ts', sha256: 'b'.repeat(64) },
              ],
            }),
          },
        ],
      },
      createdAt: auditSnapshot.createdAt + 1,
    },
  ];
  const auditModel = new ScriptedLanguageModel([]);
  const auditProviders = new ProviderService(new StaticProviderRepository(benchmarkProvider), auditModel, clock);
  let capturedTargets: string[] = [];
  const absentWorkspaceRunner = new ModelStepRunner(
    auditProviders,
    contextService([]),
    auditModel,
    new ScenarioModelCallLimiter(),
    {
      load: async (_scope, _runId, _runtimeId, targetDirectories) => {
        capturedTargets = [...targetDirectories];
        return null;
      },
    },
  );
  const absentWorkspacePrepared = await absentWorkspaceRunner.prepare(
    auditSnapshot,
    scope,
    [],
    {},
    undefined,
    undefined,
    'scenario-runtime-id',
  );
  assert.deepEqual(
    capturedTargets,
    [
      '/workspace/work',
      '/workspace/work/src/parser',
      '/workspace/work/packages/api/src',
      '/workspace/work/packages/web',
      '/workspace/work/packages/core/src',
    ],
    'project instruction target extraction must consume path-aware coding tools and reject normalized paths outside /workspace/work',
  );
  assert.equal(
    absentWorkspacePrepared.contextPlan.sourceRanges.some((source) => source.kind === 'project_instruction'),
    false,
    'a missing live workspace must remain fail-soft and must not synthesize project instructions',
  );

  const unavailableRunner = new ModelStepRunner(
    auditProviders,
    contextService([]),
    auditModel,
    new ScenarioModelCallLimiter(),
    {
      load: async () => {
        throw new Error('WORKSPACE_RUNTIME_UNAVAILABLE');
      },
    },
  );
  const unavailablePrepared = await unavailableRunner.prepare(
    auditSnapshot,
    scope,
    [],
    {},
    undefined,
    undefined,
    'scenario-runtime-id',
  );
  assert.equal(
    unavailablePrepared.contextPlan.sourceRanges.some((source) => source.kind === 'project_instruction'),
    false,
    'Runner unavailability must remain fail-soft and must not synthesize project instructions',
  );

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-project-instructions-'));
  const noRepoDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-project-instructions-no-repo-'));
  const worktreeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-project-instructions-worktree-'));
  const outsideDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-project-instructions-outside-'));
  let symlinkRejections = 0;
  let traversalRejections = 0;
  let unrelatedInstructionFiles = 0;
  let truncatedInstructionFiles = 0;
  let oversizedInstructionOmissions = 0;
  try {
    fs.mkdirSync(path.join(directory, '.git'));
    fs.mkdirSync(path.join(directory, 'src', 'parser'), { recursive: true });
    fs.mkdirSync(path.join(directory, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'AGENTS.md'), 'ROOT_FS_RULE: run parser tests.\n');
    fs.writeFileSync(
      path.join(directory, 'src', 'parser', 'AGENTS.md'),
      'NESTED_FS_RULE: do not edit generated parser output.\n',
    );
    fs.writeFileSync(path.join(directory, 'docs', 'AGENTS.md'), 'UNRELATED_FS_RULE: docs only.\n');
    const scoped = resolveProjectInstructions(directory, ['/workspace/work/src/parser']);
    assert.deepEqual(
      scoped.instructions.map((item) => item.path),
      ['/workspace/work/AGENTS.md', '/workspace/work/src/parser/AGENTS.md'],
      'Runner projection must load only root-to-target AGENTS.md files in broad-to-deep order',
    );
    assert.match(scoped.instructions[0]!.content, /ROOT_FS_RULE/);
    assert.match(scoped.instructions[1]!.content, /NESTED_FS_RULE/);
    unrelatedInstructionFiles = scoped.instructions.filter((item) => item.content.includes('UNRELATED_FS_RULE')).length;
    assert.equal(unrelatedInstructionFiles, 0, 'unrelated subtree AGENTS.md must not enter the projection');
    assert.equal(
      scoped.instructions.every((item) => /^[a-f0-9]{64}$/.test(item.hash)),
      true,
    );
    assert.equal(
      scoped.instructions.every((item) => item.projectRoot === '/workspace/work'),
      true,
    );

    fs.mkdirSync(path.join(noRepoDirectory, 'src'), { recursive: true });
    fs.writeFileSync(path.join(noRepoDirectory, 'AGENTS.md'), 'NO_REPO_ROOT_RULE\n');
    fs.writeFileSync(path.join(noRepoDirectory, 'src', 'AGENTS.md'), 'NO_REPO_NESTED_RULE\n');
    const noRepo = resolveProjectInstructions(noRepoDirectory, ['/workspace/work/src']);
    assert.deepEqual(
      noRepo.instructions.map((item) => item.projectRoot),
      ['/workspace/work', '/workspace/work'],
      'without a repo marker the current work root must be the only project root',
    );

    fs.mkdirSync(path.join(worktreeDirectory, 'packages', 'pkg', 'src'), { recursive: true });
    fs.writeFileSync(path.join(worktreeDirectory, 'AGENTS.md'), 'OUTER_ROOT_RULE\n');
    fs.writeFileSync(path.join(worktreeDirectory, 'packages', 'pkg', '.git'), 'gitdir: /safe/worktree-metadata\n');
    fs.writeFileSync(path.join(worktreeDirectory, 'packages', 'pkg', 'AGENTS.md'), 'WORKTREE_ROOT_RULE\n');
    const worktree = resolveProjectInstructions(worktreeDirectory, ['/workspace/work/packages/pkg/src']);
    assert.deepEqual(
      worktree.instructions.map((item) => item.path),
      ['/workspace/work/packages/pkg/AGENTS.md'],
      'a deeper .git worktree marker must reset project-root scope and exclude outer instructions',
    );
    assert.equal(worktree.instructions[0]!.projectRoot, '/workspace/work/packages/pkg');

    fs.writeFileSync(path.join(outsideDirectory, 'AGENTS.md'), 'OUTSIDE_RULE\n');
    fs.symlinkSync(outsideDirectory, path.join(directory, 'linked'), 'dir');
    assert.throws(
      () => resolveProjectInstructions(directory, ['/workspace/work/linked']),
      /WORKSPACE_PATH_FORBIDDEN/,
      'symlinked target directories must fail closed',
    );
    symlinkRejections += 1;
    assert.throws(
      () => resolveProjectInstructions(directory, ['/workspace/work/../../outside']),
      /WORKSPACE_PATH_FORBIDDEN/,
      'logical path traversal outside /workspace/work must fail closed',
    );
    traversalRejections += 1;

    const truncatedContent =
      'TRUNCATED_RULE_MARKER\n' + 'x'.repeat(PROJECT_INSTRUCTION_LIMITS.maxContentBytesPerFile + 512);
    fs.writeFileSync(path.join(noRepoDirectory, 'AGENTS.md'), truncatedContent);
    const truncatedProjection = resolveProjectInstructions(noRepoDirectory, ['/workspace/work']);
    assert.equal(truncatedProjection.instructions[0]!.truncated, true);
    assert.ok(
      truncatedProjection.instructions[0]!.contentBytes <= PROJECT_INSTRUCTION_LIMITS.maxContentBytesPerFile,
      'project instruction content must respect the per-file byte projection budget',
    );
    assert.equal(truncatedProjection.instructions[0]!.sourceBytes, Buffer.byteLength(truncatedContent, 'utf8'));
    truncatedInstructionFiles += 1;

    fs.writeFileSync(
      path.join(noRepoDirectory, 'AGENTS.md'),
      Buffer.alloc(PROJECT_INSTRUCTION_LIMITS.maxSourceFileBytes + 1, 0x61),
    );
    const oversizedProjection = resolveProjectInstructions(noRepoDirectory, ['/workspace/work']);
    assert.equal(oversizedProjection.instructions.length, 0);
    assert.deepEqual(
      oversizedProjection.omitted,
      [{ path: '/workspace/work/AGENTS.md', reason: 'source_too_large' }],
      'oversized instruction files must be omitted deterministically rather than partially trusted',
    );
    oversizedInstructionOmissions += 1;

    return [
      {
        name: 'project_instruction_tokens',
        value: withProject.tokenDiagnostics.projectInstructionTokens,
        unit: 'tokens',
      },
      {
        name: 'project_instruction_sources',
        value: withProject.sourceRanges.filter((source) => source.kind === 'project_instruction').length,
        unit: 'sources',
      },
      {
        name: 'stable_prefix_changed',
        value: withProject.stablePrefixHash !== withoutProject.stablePrefixHash ? 1 : 0,
        unit: 'cases',
      },
      { name: 'scoped_instruction_files', value: scoped.instructions.length, unit: 'files' },
      { name: 'unrelated_instruction_files', value: unrelatedInstructionFiles, unit: 'files' },
      { name: 'symlink_rejections', value: symlinkRejections, unit: 'cases' },
      { name: 'traversal_rejections', value: traversalRejections, unit: 'cases' },
      { name: 'truncated_instruction_files', value: truncatedInstructionFiles, unit: 'files' },
      { name: 'oversized_instruction_omissions', value: oversizedInstructionOmissions, unit: 'files' },
      { name: 'project_instruction_http_codec_cases', value: httpCodecCases, unit: 'cases' },
      { name: 'project_instruction_generation_conflicts', value: generationConflictCases, unit: 'cases' },
      { name: 'project_instruction_fail_soft_cases', value: 2, unit: 'cases' },
      { name: 'project_instruction_outside_cwd_rejections', value: 1, unit: 'cases' },
    ];
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(noRepoDirectory, { recursive: true, force: true });
    fs.rmSync(worktreeDirectory, { recursive: true, force: true });
    fs.rmSync(outsideDirectory, { recursive: true, force: true });
  }
};

const contextTokenAccountingScenario: Scenario = async () => {
  const anchorService = contextService([
    entry(1, 'user_input', { text: 'Summarize the repository state.' }),
    entry(2, 'assistant_message', { text: 'Previous summary.' }),
  ]);
  const anchorInput = {
    scope,
    threadId: 'scenario-thread',
    runId: 'scenario-run',
    currentInput: 'Continue with the summary.',
    modelContextWindow: 8_192,
    maxContextTokens: 8_000,
    reservedOutputTokens: 128,
    maxRecallItems: 5,
    maxRecallBytes: 8_192,
    tools: [],
  } as const;
  const unanchored = await anchorService.compose(anchorInput);
  const anchorDelta = 320;
  const anchored = await anchorService.compose({
    ...anchorInput,
    usageAnchor: {
      heuristicInputTokens: unanchored.estimatedInputTokens,
      providerInputTokens: unanchored.estimatedInputTokens + anchorDelta,
    },
  } as Parameters<ContextService['compose']>[0] & {
    usageAnchor: { heuristicInputTokens: number; providerInputTokens: number };
  });
  assert.equal(
    anchored.estimatedInputTokens,
    unanchored.estimatedInputTokens + anchorDelta,
    'provider actual usage must shift the next same-lineage context estimate by the prior estimator error',
  );

  const telemetryPlan = await contextService([
    entry(1, 'assistant_message', {
      text: '',
      toolCalls: [{ id: 'telemetry-call', name: 'file_search', argumentsJson: '{"query":"needle"}' }],
    }),
    entry(2, 'tool_result', { toolCallId: 'telemetry-call', content: 'matched content' }),
  ]).compose(anchorInput);
  assert.ok(telemetryPlan.tokenDiagnostics.stableInstructionTokens > 0);
  assert.ok(telemetryPlan.tokenDiagnostics.rawHistoryTokens > 0);
  assert.ok(
    telemetryPlan.tokenDiagnostics.toolExchangeTokens > 0 &&
      telemetryPlan.tokenDiagnostics.toolExchangeTokens <= telemetryPlan.tokenDiagnostics.rawHistoryTokens,
    'context token diagnostics must expose Tool exchange cost as a bounded subset of raw history',
  );

  const runtime: RuntimeParticipantView = {
    id: 'subagent-context-runtime',
    runId: 'subagent-context-run',
    participantId: 'child:subagent-context-delegation',
    backendKind: 'native',
    modelRef: { providerId: 'scenario-provider', modelId: 'scenario-model', configurationVersion: 1 },
    status: 'running',
    scheduleState: 'runnable',
    consumedMailboxSequence: 0,
  };
  let subagentToolArguments: JsonValue = { query: 'small' };
  const runtimes = {
    runtime: async () => runtime,
    recentRuntimeToolExchanges: async (): Promise<RuntimeToolExchangeView[]> => [
      {
        sourceModelStepId: 'subagent-model-step',
        batchIndex: 0,
        batchSize: 1,
        providerCallId: 'subagent-provider-call',
        toolName: 'file_search',
        arguments: subagentToolArguments,
        result: {
          ok: true,
          summary: 'done',
          artifactRefs: [],
          truncated: false,
          outcome: 'confirmed',
          verification: { status: 'verified', summary: 'fixture', evidenceRefs: [] },
        },
        status: 'succeeded',
      },
    ],
  } as unknown as RuntimeParticipantRepositoryPort;
  const mailboxes = {
    readMessages: async () => [],
    listDelegationMessages: async () => [],
  } as MailboxReaderPort;
  const subagentContext = new SubagentContextBuilder(
    runtimes,
    mailboxes,
    { discover: () => [] } as unknown as ToolCatalog,
    new CapabilityRegistry(),
    emptyModelContinuations,
    null!,
    { nowUnixSeconds: () => 1_800_000_000 } as ClockPort,
  );
  const delegation = {
    id: 'subagent-context-delegation',
    runId: 'subagent-context-run',
    parentRuntimeId: 'root-runtime',
    childRuntimeId: runtime.id,
    profileId: 'default',
    grants: [],
    peerMessaging: 'parent-child',
    mutationMode: 'read-only',
    modelRef: runtime.modelRef,
    objective: 'Inspect the repository.',
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
  const subagentRun = {
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      steps: 0,
      subagentMessages: 0,
      subagentMessageBytes: 0,
    },
    budget: { maxRunSteps: 32, maxToolOutputBytes: 65_536, contextPolicy: freezeRunContextPolicy('normal') },
    definition: { environment: null },
  } as unknown as RunView;
  const subagentModel = {
    id: 'scenario-model',
    contextWindow: 16_384,
    maxOutputTokens: 2_048,
    supportsTools: true,
    supportsImageInput: false,
    supportsFileInput: false,
  } as Parameters<SubagentContextBuilder['prepare']>[4];
  const smallSubagent = await subagentContext.prepare(
    scope,
    'subagent-context-run',
    runtime.id,
    delegation,
    subagentModel,
    subagentRun,
  );
  assert.equal(smallSubagent.kind, 'ready');
  subagentToolArguments = { patch: '界'.repeat(4_000), code: 'const value = '.repeat(200) };
  const largeSubagent = await subagentContext.prepare(
    scope,
    'subagent-context-run',
    runtime.id,
    delegation,
    subagentModel,
    subagentRun,
  );
  assert.equal(largeSubagent.kind, 'ready');
  if (smallSubagent.kind !== 'ready' || largeSubagent.kind !== 'ready') throw new Error('SCENARIO_INVALID');
  const subagentArgumentDelta = largeSubagent.plan.estimatedInputTokens - smallSubagent.plan.estimatedInputTokens;
  assert.ok(
    subagentArgumentDelta > 500,
    'Subagent model accounting must include bounded assistant Tool-call arguments, including CJK/code/JSON payloads',
  );

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-context-token-accounting-'));
  const db = new DatabaseAdapter({
    dataDirectory: directory,
    filename: 'context-token-accounting.sqlite',
    nodeEnv: 'test',
  });
  const stateCommit = new SqliteStateCommitAdapter(db);
  const now = 1_801_050_000;
  const runId = 'context-token-accounting-run';
  const runtimeId = 'context-token-accounting-runtime';
  const primaryModel = { providerId: 'scenario-provider', modelId: 'scenario-model', configurationVersion: 1 };
  const fallbackModel = { providerId: 'scenario-provider', modelId: 'scenario-fallback', configurationVersion: 1 };
  const primaryCapabilities = {
    contextWindow: 16_384,
    maxOutputTokens: 2_048,
    supportsTools: true,
    supportsImageInput: false,
    supportsFileInput: false,
  };
  const fallbackCapabilities = { ...primaryCapabilities, contextWindow: 32_768 };
  const budget = JSON.stringify({
    maxRunSteps: 16,
    maxActiveExecutionSeconds: 3_600,
    toolTimeoutSeconds: 120,
    maxToolOutputBytes: 1_048_576,
    maxRecallItems: 5,
    maxRecallBytes: 8_192,
    maxSubagentMessages: 100,
    maxSubagentMessageBytes: 1_048_576,
    contextPolicy: freezeRunContextPolicy('normal'),
    contextCompactionMode: 'balanced',
    revision: 1,
  });
  const definition = JSON.stringify({
    schemaVersion: 1,
    agentDefinitionId: 'scenario-agent',
    requiredModelCapabilities: [],
    model: primaryModel,
    modelCapabilities: primaryCapabilities,
    rootModelRoutes: [{ model: fallbackModel, modelCapabilities: fallbackCapabilities }],
    approvalMode: 'ask',
    executionMode: 'execute',
    connectionIds: [],
    environment: null,
    policyRevision: 1,
    settingsRevision: 1,
  });
  const usage = JSON.stringify({
    inputTokens: 1_000,
    outputTokens: 100,
    cachedInputTokens: 250,
    steps: 2,
    subagentMessages: 0,
    subagentMessageBytes: 0,
  });
  try {
    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'context-token-user', 'not-used')");
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
       VALUES (1, 'scenario-app', '1.0.0', 'enabled', 'running', 1, ?, ?)`,
      [now, now],
    );
    await db.execute(
      `INSERT INTO ai_threads (id, user_id, app_id, title, title_source, created_at, updated_at)
       VALUES ('context-token-thread', 1, 'scenario-app', 'context token accounting', 'manual', ?, ?)`,
      [now, now],
    );
    await db.execute(
      `INSERT INTO agent_runs
        (id, user_id, app_id, thread_id, status, goal_status, verification_status,
         budget_json, definition_json, plan_json, usage_json, executing_runtime_count,
         created_at, started_at, updated_at)
       VALUES (?, 1, 'scenario-app', 'context-token-thread', 'running', 'in_progress', 'not_started',
               ?, ?, '{"schemaVersion":1,"revision":0,"items":[]}', ?, 0, ?, ?, ?)`,
      [runId, budget, definition, usage, now, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES (?, ?, 'root', 'native', ?, 'running', 'runnable', 0, 'context-token-owner', ?, ?)`,
      [runtimeId, runId, JSON.stringify(primaryModel), now, now],
    );

    const begun = await stateCommit.beginModelStep({
      scope,
      runId,
      runtimeId,
      expectedRunVersion: 1,
      inputWatermark: 0,
      reservedTokens: 768,
      estimatedInputTokens: 512,
      heuristicInputTokens: 192,
      contextSource: 'anchored_estimate',
      reservedOutputTokens: 256,
      contextWindowTokens: 16_384,
      contextEpoch: 'context-token-primary-epoch',
      model: primaryModel,
      now: now + 1,
    });
    assert.deepEqual(begun.run.usage.context, {
      inputTokens: 512,
      heuristicInputTokens: 192,
      reservedOutputTokens: 256,
      contextWindowTokens: 16_384,
      source: 'anchored_estimate',
      model: primaryModel,
      contextEpoch: 'context-token-primary-epoch',
      updatedAt: now + 1,
    });
    const changed = await stateCommit.changeModelRoute({
      scope,
      runId,
      runtimeId,
      stepId: begun.stepId,
      attemptId: begun.attemptId,
      expectedRunVersion: begun.run.version,
      fromModel: primaryModel,
      toModel: fallbackModel,
      toRouteIndex: 1,
      reservedTokens: 1_024,
      estimatedInputTokens: 700,
      heuristicInputTokens: 680,
      contextSource: 'estimated',
      reservedOutputTokens: 324,
      contextWindowTokens: 32_768,
      contextEpoch: 'context-token-fallback-epoch',
      usage: begun.run.usage,
      inputTokens: 600,
      outputTokens: 10,
      cachedInputTokens: 100,
      estimatedUsage: false,
      errorCode: 'PROVIDER_UNAVAILABLE',
      now: now + 2,
    });
    assert.deepEqual(
      changed.run.usage.context,
      {
        inputTokens: 700,
        heuristicInputTokens: 680,
        reservedOutputTokens: 324,
        contextWindowTokens: 32_768,
        source: 'estimated',
        model: fallbackModel,
        contextEpoch: 'context-token-fallback-epoch',
        updatedAt: now + 2,
      },
      'route failover must replace the previous route context projection before the next attempt',
    );

    const settled = await stateCommit.settleModelStep({
      scope,
      runId,
      runtimeId,
      stepId: begun.stepId,
      attemptId: changed.attemptId,
      expectedRunVersion: changed.run.version,
      assistantEntryId: 'context-token-final',
      assistantText: 'Done.',
      usage: changed.run.usage,
      inputTokens: 845,
      outputTokens: 25,
      cachedInputTokens: 200,
      estimatedUsage: false,
      finishReason: 'stop',
      terminalStatus: 'completed_unverified',
      now: now + 3,
    });
    assert.deepEqual(
      settled.run.usage.context,
      {
        inputTokens: 845,
        heuristicInputTokens: 680,
        reservedOutputTokens: 324,
        contextWindowTokens: 32_768,
        source: 'provider',
        model: fallbackModel,
        contextEpoch: 'context-token-fallback-epoch',
        updatedAt: now + 3,
      },
      'provider input usage must become the latest prompt context occupancy without changing cumulative usage semantics',
    );
    assert.equal(settled.run.usage.inputTokens, 2_445, 'cumulative input usage must remain cumulative across attempts');

    return [
      { name: 'anchor_delta_tokens', value: anchorDelta, unit: 'tokens' },
      { name: 'subagent_tool_argument_delta', value: subagentArgumentDelta, unit: 'tokens' },
      { name: 'provider_context_tokens', value: settled.run.usage.context?.inputTokens ?? 0, unit: 'tokens' },
      { name: 'cumulative_input_tokens', value: settled.run.usage.inputTokens, unit: 'tokens' },
    ];
  } finally {
    await db.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

const toolResultProjectionScenario: Scenario = async () => {
  const maxModelBytes = 1_024;
  const rawLog = [
    'HEAD marker: compilation started',
    ...Array.from(
      { length: 900 },
      (_, index) => `noise-${index.toString().padStart(4, '0')} lorem ipsum dolor sit amet`,
    ),
    'ERROR critical failure: unresolved symbol at src/main.ts:42',
    'TAIL marker: process exited with code 1',
  ].join('\n');
  const rawResult: ToolResult = {
    ok: false,
    summary: 'Build failed after producing a large diagnostic log.',
    data: {
      log: rawLog,
      exitCode: 1,
      command: 'pnpm build',
      nested: { status: 'failed', detail: 'diagnostic payload' },
    },
    artifactRefs: ['artifact-raw-log'],
    truncated: false,
    outcome: 'confirmed',
    errorCode: 'BUILD_FAILED',
    verification: {
      status: 'failed',
      summary: 'The build command returned exit code 1.',
      evidenceRefs: ['artifact-build-evidence'],
    },
  };
  const rawBytes = Buffer.byteLength(JSON.stringify(rawResult), 'utf8');
  assert.ok(rawBytes > maxModelBytes * 10, 'fixture must be materially larger than the model-facing budget');

  const catalog = new ToolCatalog();
  const fixtureTool: AgentTool = {
    descriptor: {
      name: 'scenario_large_output',
      version: '1',
      description: 'Return a deliberately large deterministic ToolResult.',
      inputSchema: { type: 'object', additionalProperties: false },
      riskClass: 'read',
    },
    inspect: async (input, context, policyRevision) => ({
      toolName: 'scenario_large_output',
      toolVersion: '1',
      normalizedArguments: input,
      target: {
        kind: 'run',
        targetIdentity: context.runId,
        endpoint: context.runId,
        loginUser: context.agentRuntimeId,
        configurationHash: 'tool-result-projection',
      },
      resourceKeys: ['scenario:tool-result-projection'],
      risk: 'read',
      mutation: false,
      operationHash: 'tool-result-projection',
      operationHashVersion: 1,
      preconditions: [],
      policyRevision,
      inputRevision: context.inputRevision,
    }),
    execute: async () => rawResult,
  };
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'scenario.tool-result-projection',
    tools: [fixtureTool],
  });
  const executor = new ToolExecutor(catalog, {
    authorize: async () => ({ allowed: true as const, policyRevision: 1 }),
  } as unknown as AppCapabilityBroker);
  const toolContext: ToolContext = {
    ...scope,
    actor: {
      kind: 'agent',
      userId: scope.userId,
      appId: scope.appId,
      runId: 'tool-result-projection-run',
      agentRuntimeId: 'tool-result-projection-runtime',
    },
    runId: 'tool-result-projection-run',
    agentRuntimeId: 'tool-result-projection-runtime',
    connectionIds: [],
    environment: null,
    stepId: 'tool-result-projection-step',
    signal: new AbortController().signal,
    deadlineAt: 1_900_000_000,
    maxOutputBytes: maxModelBytes,
    inputRevision: 1,
  };
  const inspection = await executor.inspect(toolContext, {
    providerCallId: 'provider-large-output',
    name: 'scenario_large_output',
    argumentsJson: '{}',
  });
  const executed = await executor.execute(toolContext, inspection);
  assert.equal(
    (executed.data as { log?: string } | undefined)?.log,
    rawLog,
    'ToolExecutor must return the raw execution truth; model-facing projection must not destroy durable evidence before StateCommit',
  );

  const projected = projectToolResult(rawResult, maxModelBytes);
  const projectedBytes = Buffer.byteLength(JSON.stringify(projected), 'utf8');
  assert.ok(projectedBytes <= maxModelBytes, 'model-facing ToolResult projection must respect maxToolOutputBytes');
  const projectedEncoded = JSON.stringify(projected);
  assert.match(projectedEncoded, /ERROR critical failure/, 'projection must preserve high-signal error lines');
  assert.match(
    projectedEncoded,
    /TAIL marker/,
    'projection must preserve tail diagnostics instead of prefix-only truncation',
  );
  assert.deepEqual(
    projected.artifactRefs,
    ['artifact-raw-log'],
    'artifactRefs must survive model projection when budget allows',
  );
  const projectionMetadata = projected as ToolResult & {
    projection?: { originalBytes: number; sha256: string };
  };
  assert.equal(projectionMetadata.projection?.originalBytes, rawBytes, 'projection must disclose original byte size');
  assert.match(
    projectionMetadata.projection?.sha256 ?? '',
    /^[a-f0-9]{64}$/,
    'projection must disclose a stable raw hash',
  );

  const runtime: RuntimeParticipantView = {
    id: 'tool-result-child-runtime',
    runId: 'tool-result-child-run',
    participantId: 'child:tool-result-delegation',
    backendKind: 'native',
    modelRef: { providerId: 'scenario-provider', modelId: 'scenario-model', configurationVersion: 1 },
    status: 'running',
    scheduleState: 'runnable',
    consumedMailboxSequence: 0,
  };
  const runtimes = {
    runtime: async () => runtime,
    recentRuntimeToolExchanges: async (): Promise<RuntimeToolExchangeView[]> => [
      {
        sourceModelStepId: 'tool-result-child-model-step',
        batchIndex: 0,
        batchSize: 1,
        providerCallId: 'provider-child-large-output',
        toolName: 'scenario_large_output',
        arguments: {},
        result: rawResult as unknown as JsonValue,
        status: 'failed',
      },
    ],
  } as unknown as RuntimeParticipantRepositoryPort;
  const childBuilder = new SubagentContextBuilder(
    runtimes,
    { readMessages: async () => [], listDelegationMessages: async () => [] } as MailboxReaderPort,
    { discover: () => [] } as unknown as ToolCatalog,
    new CapabilityRegistry(),
    emptyModelContinuations,
    null!,
    { nowUnixSeconds: () => 1_800_000_000 } as ClockPort,
  );
  const delegation = {
    id: 'tool-result-delegation',
    runId: 'tool-result-child-run',
    parentRuntimeId: 'root-runtime',
    childRuntimeId: runtime.id,
    profileId: 'default',
    grants: [],
    peerMessaging: 'parent-child',
    mutationMode: 'read-only',
    modelRef: runtime.modelRef,
    objective: 'Inspect a build failure.',
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
  const childRun = {
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      steps: 0,
      subagentMessages: 0,
      subagentMessageBytes: 0,
    },
    budget: { maxRunSteps: 32, maxToolOutputBytes: maxModelBytes, contextPolicy: freezeRunContextPolicy('normal') },
    definition: { environment: null },
  } as unknown as RunView;
  const childPrepared = await childBuilder.prepare(
    scope,
    'tool-result-child-run',
    runtime.id,
    delegation,
    {
      id: 'scenario-model',
      contextWindow: 32_768,
      maxOutputTokens: 2_048,
      supportsTools: true,
      supportsImageInput: false,
      supportsFileInput: false,
    },
    childRun,
  );
  assert.equal(childPrepared.kind, 'ready');
  if (childPrepared.kind !== 'ready') throw new Error('SCENARIO_INVALID');
  const childToolMessage = childPrepared.plan.messages.find(
    (message) => message.role === 'tool' && message.toolCallId === 'provider-child-large-output',
  );
  assert.ok(childToolMessage, 'Subagent context must retain the completed Tool exchange');
  assert.ok(
    Buffer.byteLength(childToolMessage.content, 'utf8') <= maxModelBytes,
    'Subagent ToolResult projection must use the same model-facing byte budget instead of a separate 8 KiB rule',
  );
  assert.match(
    childToolMessage.content,
    /ERROR critical failure/,
    'Subagent projection must preserve high-signal errors',
  );
  assert.match(childToolMessage.content, /TAIL marker/, 'Subagent projection must preserve tail diagnostics');

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-tool-result-projection-'));
  const db = new DatabaseAdapter({
    dataDirectory: directory,
    filename: 'tool-result-projection.sqlite',
    nodeEnv: 'test',
  });
  const stateCommit = new SqliteStateCommitAdapter(db);
  const now = 1_801_060_000;
  const budget = JSON.stringify({
    maxRunSteps: 32,
    maxActiveExecutionSeconds: 3_600,
    toolTimeoutSeconds: 120,
    maxToolOutputBytes: maxModelBytes,
    maxRecallItems: 5,
    maxRecallBytes: 8_192,
    maxSubagentMessages: 100,
    maxSubagentMessageBytes: 1_048_576,
    contextPolicy: freezeRunContextPolicy('normal'),
    contextCompactionMode: 'balanced',
    revision: 1,
  });
  const definition = JSON.stringify({
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
  });
  const usage = JSON.stringify({
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    steps: 0,
    subagentMessages: 0,
    subagentMessageBytes: 0,
  });
  try {
    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'tool-result-user', 'not-used')");
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
       VALUES (1, 'scenario-app', '1.0.0', 'enabled', 'running', 1, ?, ?)`,
      [now, now],
    );
    await db.execute(
      `INSERT INTO ai_threads (id, user_id, app_id, title, title_source, created_at, updated_at)
       VALUES ('tool-result-thread', 1, 'scenario-app', 'tool result projection', 'manual', ?, ?)`,
      [now, now],
    );
    await db.execute(
      `INSERT INTO agent_runs
        (id, user_id, app_id, thread_id, status, goal_status, verification_status,
         budget_json, definition_json, plan_json, usage_json, executing_runtime_count,
         created_at, started_at, updated_at)
       VALUES ('tool-result-run', 1, 'scenario-app', 'tool-result-thread', 'running', 'in_progress', 'not_started',
               ?, ?, '{"schemaVersion":1,"revision":0,"items":[]}', ?, 1, ?, ?, ?)`,
      [budget, definition, usage, now, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES ('tool-result-runtime', 'tool-result-run', 'root', 'native', ?,
               'running', 'executing', 0, 'tool-result-owner', ?, ?)`,
      [JSON.stringify(runtime.modelRef), now, now],
    );
    await db.execute(
      `INSERT INTO agent_steps
        (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
         input_refs_json, output_refs_json, created_at, completed_at)
       VALUES ('tool-result-model-step', 'tool-result-run', 'tool-result-runtime', 1,
               'model', 'completed', 0, '[]', '[]', ?, ?)`,
      [now, now],
    );
    await db.execute(
      `INSERT INTO agent_steps
        (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
         input_refs_json, output_refs_json, created_at)
       VALUES ('tool-result-step', 'tool-result-run', 'tool-result-runtime', 2,
               'tool', 'created', 0, '[]', '[]', ?)`,
      [now],
    );
    await db.execute(
      `INSERT INTO agent_tool_calls
        (id, run_id, agent_runtime_id, step_id, source_model_step_id, batch_index, batch_size,
         provider_call_id, tool_name, tool_version, inspection_json, operation_hash,
         operation_hash_version, risk, status, created_at)
       VALUES ('tool-result-call', 'tool-result-run', 'tool-result-runtime', 'tool-result-step',
               'tool-result-model-step', 0, 1, 'provider-root-large-output', 'scenario_large_output', '1',
               '{}', 'tool-result-hash', 1, 'read', 'proposed', ?)`,
      [now],
    );
    const begun = await stateCommit.beginReadToolBatch({
      scope,
      runId: 'tool-result-run',
      runtimeId: 'tool-result-runtime',
      expectedRunVersion: 1,
      items: [{ toolStepId: 'tool-result-step', toolCallId: 'tool-result-call' }],
      now: now + 1,
    });
    await stateCommit.settleReadToolBatch({
      scope,
      runId: 'tool-result-run',
      runtimeId: 'tool-result-runtime',
      expectedRunVersion: begun.run.version,
      items: [
        {
          toolStepId: 'tool-result-step',
          toolCallId: 'tool-result-call',
          toolResultEntryId: 'tool-result-ledger-entry',
          providerCallId: 'provider-root-large-output',
          result: rawResult,
        },
      ],
      now: now + 2,
    });
    const stored = await db.queryOne<{ result_json: string }>(
      "SELECT result_json FROM agent_tool_calls WHERE id = 'tool-result-call'",
    );
    assert.ok(stored?.result_json);
    assert.equal(
      (JSON.parse(stored!.result_json) as { data?: { log?: string } }).data?.log,
      rawLog,
      'agent_tool_calls.result_json must retain raw Tool evidence',
    );
    const ledger = await db.queryOne<{ payload_json: string }>(
      "SELECT payload_json FROM ai_thread_entries WHERE id = 'tool-result-ledger-entry'",
    );
    assert.ok(ledger?.payload_json);
    const ledgerPayload = JSON.parse(ledger!.payload_json) as { text?: string };
    assert.equal(typeof ledgerPayload.text, 'string');
    assert.ok(
      Buffer.byteLength(ledgerPayload.text!, 'utf8') <= maxModelBytes,
      'Ledger tool_result must store the bounded model-facing projection, not the raw result',
    );
    assert.match(ledgerPayload.text!, /ERROR critical failure/);
    assert.match(ledgerPayload.text!, /TAIL marker/);
    assert.ok(!ledgerPayload.text!.includes('noise-0899'), 'projection must not serialize the entire raw log');

    return [
      { name: 'raw_result_bytes', value: rawBytes, unit: 'bytes' },
      { name: 'projected_result_bytes', value: projectedBytes, unit: 'bytes' },
      { name: 'root_ledger_bytes', value: Buffer.byteLength(ledgerPayload.text!, 'utf8'), unit: 'bytes' },
      { name: 'subagent_tool_result_bytes', value: Buffer.byteLength(childToolMessage.content, 'utf8'), unit: 'bytes' },
    ];
  } finally {
    await db.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

interface AgentBenchmarkCase {
  id: 'coding' | 'operations';
  prompt: string;
  toolName: string;
  toolArgumentsJson: string;
  toolDescription: string;
  toolInputSchema: AgentTool['descriptor']['inputSchema'];
  toolSummary: string;
  finalText: string;
  usage: readonly [TokenUsage, TokenUsage];
}

const benchmarkProvider: PersistedProviderView = {
  id: 'scenario-provider',
  kind: 'openai-compatible',
  displayName: 'Scenario provider',
  baseUrl: 'http://scenario.invalid/v1',
  protocol: 'chat-completions',
  hasCredential: false,
  credentialRevision: 0,
  models: [
    {
      id: 'scenario-model',
      capabilityOverrides: {
        contextWindow: 8_192,
        maxOutputTokens: 1_024,
        supportsTools: true,
      },
    },
  ],
  liveCapabilities: [],
  enabled: true,
  version: 1,
  createdAt: 1_800_000_000,
  updatedAt: 1_800_000_000,
};

const drainGenerator = async <T>(generator: AsyncGenerator<unknown, T, void>): Promise<T> => {
  while (true) {
    const next = await generator.next();
    if (next.done) return next.value;
  }
};

const collectBackendSignals = async <T>(
  generator: AsyncGenerator<BackendSignal, T, void>,
): Promise<{ signals: BackendSignal[]; result: T }> => {
  const signals: BackendSignal[] = [];
  while (true) {
    const next = await generator.next();
    if (next.done) return { signals, result: next.value };
    signals.push(next.value);
  }
};

const benchmarkSnapshot = (benchmark: AgentBenchmarkCase, benchmarkScope: Scope): RunSnapshot => {
  const runId = `benchmark-${benchmark.id}-run`;
  const threadId = `benchmark-${benchmark.id}-thread`;
  const createdAt = 1_800_000_000;
  return {
    ...benchmarkScope,
    id: runId,
    threadId,
    parentRunId: null,
    status: 'running',
    goalStatus: 'in_progress',
    goal: { text: benchmark.prompt, revision: 1, updatedAt: createdAt },
    verificationStatus: 'not_started',
    needsReconciliation: false,
    budget: {
      maxRunSteps: 100,
      maxActiveExecutionSeconds: 3_600,
      toolTimeoutSeconds: 120,
      maxToolOutputBytes: 64 * 1_024,
      maxRecallItems: 5,
      maxRecallBytes: 8_192,
      maxSubagentMessages: 100,
      maxSubagentMessageBytes: 1_048_576,
      contextPolicy: freezeRunContextPolicy('normal'),
      contextCompactionMode: 'balanced',
      revision: 1,
    },
    definition: {
      schemaVersion: 1,
      agentDefinitionId: 'scenario-agent',
      requiredModelCapabilities: [],
      model: { providerId: benchmarkProvider.id, modelId: 'scenario-model', configurationVersion: 1 },
      modelCapabilities: SCENARIO_MODEL_CAPABILITIES,
      rootModelRoutes: [],
      approvalMode: 'full_access',
      executionMode: 'execute',
      connectionIds: [],
      environment: null,
      policyRevision: 1,
      settingsRevision: 1,
    },
    plan: { schemaVersion: 1, revision: 0, items: [] },
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      steps: 0,
      subagentMessages: 0,
      subagentMessageBytes: 0,
    },
    activeExecutionSeconds: 0,
    activeExecutionStartedAt: createdAt,
    executingRuntimeCount: 1,
    consumedInputSequence: 0,
    inputRevision: 1,
    eventCursor: 0,
    version: 1,
    createdAt,
    startedAt: createdAt,
    completedAt: null,
    updatedAt: createdAt,
    terminalIssue: null,
    recentEntries: [
      {
        id: `${benchmark.id}-input`,
        sequence: 1,
        kind: 'user_input',
        payload: { text: benchmark.prompt, artifactRefs: [] },
        createdAt,
      },
    ],
  };
};

const scriptedAgentBenchmarkScenario: Scenario = async () => {
  const benchmarks: readonly AgentBenchmarkCase[] = [
    {
      id: 'coding',
      prompt: 'Inspect src/example.ts and report the exported function name.',
      toolName: 'scenario_read_file',
      toolArgumentsJson: JSON.stringify({ path: 'src/example.ts' }),
      toolDescription: 'Read a deterministic source file fixture.',
      toolInputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
        additionalProperties: false,
      },
      toolSummary: 'src/example.ts exports function solveExample().',
      finalText: 'The exported function is solveExample().',
      usage: [
        { inputTokens: 180, outputTokens: 24, cachedInputTokens: 80 },
        { inputTokens: 236, outputTokens: 18, cachedInputTokens: 160 },
      ],
    },
    {
      id: 'operations',
      prompt: 'Check the api service status and report whether it is healthy.',
      toolName: 'scenario_service_status',
      toolArgumentsJson: JSON.stringify({ service: 'api' }),
      toolDescription: 'Read a deterministic service-health fixture.',
      toolInputSchema: {
        type: 'object',
        properties: { service: { type: 'string' } },
        required: ['service'],
        additionalProperties: false,
      },
      toolSummary: 'api is healthy; desired=1 ready=1.',
      finalText: 'The api service is healthy (1/1 ready).',
      usage: [
        { inputTokens: 164, outputTokens: 20, cachedInputTokens: 72 },
        { inputTokens: 218, outputTokens: 17, cachedInputTokens: 144 },
      ],
    },
  ];

  let taskSuccesses = 0;
  let modelSteps = 0;
  let modelCalls = 0;
  let toolCalls = 0;
  let duplicateReadSearchCalls = 0;
  let verifiedCases = 0;
  const totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };

  for (const benchmark of benchmarks) {
    const benchmarkScope: Scope = { userId: 1, appId: `benchmark-${benchmark.id}-app` };
    const snapshot = benchmarkSnapshot(benchmark, benchmarkScope);
    const initialEntry: LedgerEntryView = {
      id: `${benchmark.id}-input`,
      threadId: snapshot.threadId,
      runId: snapshot.id,
      sequence: 1,
      kind: 'user_input',
      payload: { text: benchmark.prompt, artifactRefs: [] },
      createdAt: snapshot.createdAt,
    };
    const conversationRepository = new StaticConversationRepository([initialEntry]);
    const conversations = new ConversationService(conversationRepository, clock, null!, null!);
    const context = new ContextService(
      conversations,
      new RecallService(new EmptyRecallRepository(), clock),
      new SkillRegistry(),
      emptyModelContinuations,
      null!,
    );

    const toolCallId = `${benchmark.id}-tool-call`;
    const argumentMidpoint = Math.max(1, Math.floor(benchmark.toolArgumentsJson.length / 2));
    const scriptedModel = new ScriptedLanguageModel([
      {
        assertRequest: (request) => {
          assert.ok(
            request.messages.some((message) => message.role === 'user' && message.content.includes(benchmark.prompt)),
            `${benchmark.id}: first model step must include current user input`,
          );
        },
        events: [
          { type: 'tool.delta', index: 0, id: toolCallId, name: benchmark.toolName },
          { type: 'tool.delta', index: 0, argumentsDelta: benchmark.toolArgumentsJson.slice(0, argumentMidpoint) },
          { type: 'tool.delta', index: 0, argumentsDelta: benchmark.toolArgumentsJson.slice(argumentMidpoint) },
          { type: 'usage', usage: benchmark.usage[0] },
          { type: 'completed', finishReason: 'tool-calls' },
        ],
      },
      {
        assertRequest: (request) => {
          const assistant = request.messages.find(
            (message) => message.role === 'assistant' && message.toolCalls?.some((call) => call.id === toolCallId),
          );
          const result = request.messages.find(
            (message) => message.role === 'tool' && message.toolCallId === toolCallId,
          );
          assert.ok(assistant, `${benchmark.id}: second model step must retain the assistant tool call`);
          assert.ok(
            result?.content.includes(benchmark.toolSummary),
            `${benchmark.id}: second model step must include tool output`,
          );
        },
        events: [
          { type: 'message.delta', text: benchmark.finalText },
          { type: 'usage', usage: benchmark.usage[1] },
          { type: 'completed', finishReason: 'stop' },
        ],
      },
    ]);
    const providers = new ProviderService(new StaticProviderRepository(benchmarkProvider), scriptedModel, clock);
    const modelRunner = new ModelStepRunner(providers, context, scriptedModel, new ScenarioModelCallLimiter());

    const catalog = new ToolCatalog();
    const executedKeys = new Set<string>();
    let duplicateCallsForCase = 0;
    const benchmarkTool: AgentTool = {
      descriptor: {
        name: benchmark.toolName,
        version: '1',
        description: benchmark.toolDescription,
        inputSchema: benchmark.toolInputSchema,
        riskClass: 'read',
      },
      inspect: async (input, toolContext, policyRevision) => ({
        toolName: benchmark.toolName,
        toolVersion: '1',
        normalizedArguments: input,
        target: {
          kind: 'run',
          targetIdentity: `run:${toolContext.runId}`,
          endpoint: `run:${toolContext.runId}`,
          loginUser: `agent-runtime:${toolContext.agentRuntimeId}`,
          configurationHash: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
        },
        resourceKeys: [`benchmark:${benchmark.id}`],
        risk: 'read',
        mutation: false,
        operationHash: createHash('sha256')
          .update(`${benchmark.toolName}:${JSON.stringify(input)}`)
          .digest('hex'),
        operationHashVersion: 1,
        preconditions: [],
        policyRevision,
        inputRevision: toolContext.inputRevision,
      }),
      execute: async (inspection) => {
        const key = `${inspection.toolName}:${JSON.stringify(inspection.normalizedArguments)}`;
        if (executedKeys.has(key)) duplicateCallsForCase += 1;
        executedKeys.add(key);
        return {
          ok: true,
          summary: benchmark.toolSummary,
          artifactRefs: [],
          truncated: false,
          outcome: 'confirmed',
          verification: { status: 'verified', summary: 'Deterministic fixture verified.', evidenceRefs: [] },
        };
      },
    };
    catalog.registerContribution({
      schemaVersion: 1,
      id: `scenario.benchmark-${benchmark.id}`,
      tools: [benchmarkTool],
    });
    const capabilities = {
      authorize: async () => ({ allowed: true as const, policyRevision: 1 }),
    } as unknown as AppCapabilityBroker;
    const executor = new ToolExecutor(catalog, capabilities);
    const signal = new AbortController().signal;

    const firstPrepared = await modelRunner.prepare(snapshot, benchmarkScope, catalog.schemas(benchmarkScope), {});
    const first = await drainGenerator(
      modelRunner.runAttempt(
        snapshot,
        firstPrepared.contextPlan,
        { attemptId: `${benchmark.id}-attempt-1`, attemptIndex: 1 },
        signal,
      ),
    );
    assert.equal(first.error, undefined, `${benchmark.id}: first model step must succeed`);
    assert.equal(first.finishReason, 'tool-calls');
    const proposed = first.toolCalls.get(0);
    assert.equal(proposed?.id, toolCallId);
    assert.equal(proposed?.name, benchmark.toolName);
    assert.equal(proposed?.argumentsJson, benchmark.toolArgumentsJson);
    assert.ok(first.usage, `${benchmark.id}: first model step must report usage`);
    modelSteps += 1;

    const toolContext: ToolContext = {
      ...benchmarkScope,
      actor: {
        kind: 'agent',
        userId: benchmarkScope.userId,
        appId: benchmarkScope.appId,
        runId: snapshot.id,
        agentRuntimeId: `${benchmark.id}-runtime`,
      },
      runId: snapshot.id,
      agentRuntimeId: `${benchmark.id}-runtime`,
      connectionIds: [],
      environment: null,
      stepId: `${benchmark.id}-step-1`,
      signal,
      deadlineAt: snapshot.createdAt + 60,
      maxOutputBytes: snapshot.budget.maxToolOutputBytes,
      inputRevision: snapshot.inputRevision,
    };
    const executed = await executor.invoke(toolContext, {
      name: proposed!.name!,
      argumentsJson: proposed!.argumentsJson,
    });
    toolCalls += 1;
    assert.equal(executed.result.outcome, 'confirmed');
    assert.equal(executed.result.verification.status, 'verified');

    await conversationRepository.appendEntry(benchmarkScope, snapshot.threadId, {
      id: `${benchmark.id}-assistant-tool`,
      runId: snapshot.id,
      kind: 'assistant_message',
      payload: {
        text: first.text,
        toolCalls: [
          {
            id: proposed!.id!,
            name: proposed!.name!,
            argumentsJson: proposed!.argumentsJson,
          },
        ],
      },
      createdAt: snapshot.createdAt + 1,
    });
    await conversationRepository.appendEntry(benchmarkScope, snapshot.threadId, {
      id: `${benchmark.id}-tool-result`,
      runId: snapshot.id,
      kind: 'tool_result',
      payload: { toolCallId, content: executed.result.summary },
      createdAt: snapshot.createdAt + 2,
    });

    const secondPrepared = await modelRunner.prepare(snapshot, benchmarkScope, catalog.schemas(benchmarkScope), {});
    assertValidToolExchange(secondPrepared.contextPlan.messages);
    const second = await drainGenerator(
      modelRunner.runAttempt(
        snapshot,
        secondPrepared.contextPlan,
        { attemptId: `${benchmark.id}-attempt-2`, attemptIndex: 1 },
        signal,
      ),
    );
    assert.equal(second.error, undefined, `${benchmark.id}: second model step must succeed`);
    assert.equal(second.finishReason, 'stop');
    assert.equal(second.text, benchmark.finalText);
    assert.ok(second.usage, `${benchmark.id}: second model step must report usage`);
    modelSteps += 1;

    scriptedModel.assertConsumed();
    modelCalls += scriptedModel.requests.length;
    duplicateReadSearchCalls += duplicateCallsForCase;
    const verified = executed.result.verification.status === 'verified';
    if (verified) verifiedCases += 1;
    if (verified && second.text === benchmark.finalText) taskSuccesses += 1;
    for (const usage of [first.usage!, second.usage!]) {
      totalUsage.inputTokens += usage.inputTokens;
      totalUsage.outputTokens += usage.outputTokens;
      totalUsage.cachedInputTokens += usage.cachedInputTokens;
    }
  }

  assert.equal(taskSuccesses, benchmarks.length, 'every deterministic benchmark task must succeed');
  assert.equal(verifiedCases, benchmarks.length, 'every benchmark tool outcome must be verified');
  assert.equal(duplicateReadSearchCalls, 0, 'benchmark must not duplicate read/search work');

  return [
    { name: 'benchmark_cases', value: benchmarks.length, unit: 'cases' },
    { name: 'task_successes', value: taskSuccesses, unit: 'cases' },
    { name: 'model_steps', value: modelSteps, unit: 'steps' },
    { name: 'model_calls', value: modelCalls, unit: 'calls' },
    { name: 'tool_calls', value: toolCalls, unit: 'calls' },
    { name: 'duplicate_read_search_calls', value: duplicateReadSearchCalls, unit: 'calls' },
    { name: 'input_tokens', value: totalUsage.inputTokens, unit: 'tokens' },
    { name: 'output_tokens', value: totalUsage.outputTokens, unit: 'tokens' },
    { name: 'cached_input_tokens', value: totalUsage.cachedInputTokens, unit: 'tokens' },
    { name: 'verified_cases', value: verifiedCases, unit: 'cases' },
  ];
};

const modelStreamRetryAttemptIdentityScenario: Scenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-stream-retry-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'stream-retry.sqlite', nodeEnv: 'test' });
  const stateCommit = new SqliteStateCommitAdapter(db);
  const repository = new SqliteRunRepository(db);
  const conversationRepository = new SqliteConversationRepository(db);
  const now = 1_800_000_000;
  const runId = 'stream-retry-run';
  const threadId = 'stream-retry-thread';
  const runtimeId = 'stream-retry-runtime';

  try {
    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'stream-retry-user', 'not-used')");
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
       VALUES (1, 'scenario-app', '1.0.0', 'enabled', 'running', 1, ?, ?)`,
      [now, now],
    );
    await db.execute(
      `INSERT INTO ai_threads
        (id, user_id, app_id, title, title_source, next_sequence, created_at, updated_at)
       VALUES (?, 1, 'scenario-app', 'stream retry', 'manual', 2, ?, ?)`,
      [threadId, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runs
        (id, user_id, app_id, thread_id, status, goal_status, goal_text, goal_revision, goal_updated_at,
         verification_status, budget_json, definition_json, plan_json, usage_json,
         active_execution_started_at, executing_runtime_count, consumed_input_sequence, input_revision,
         created_at, started_at, updated_at)
       VALUES (?, 1, 'scenario-app', ?, 'running', 'in_progress', 'Return a greeting.', 1, ?,
               'not_started', ?, ?, ?, ?, NULL, 0, 0, 1, ?, ?, ?)`,
      [
        runId,
        threadId,
        now,
        JSON.stringify({
          maxRunSteps: 20,
          maxActiveExecutionSeconds: 3_600,
          toolTimeoutSeconds: 120,
          maxToolOutputBytes: 1_048_576,
          maxRecallItems: 5,
          maxRecallBytes: 8_192,
          maxSubagentMessages: 100,
          maxSubagentMessageBytes: 1_048_576,
          contextPolicy: freezeRunContextPolicy('normal'),
          contextCompactionMode: 'balanced',
          revision: 1,
        }),
        JSON.stringify({
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
        }),
        JSON.stringify({ schemaVersion: 1, revision: 0, items: [] }),
        JSON.stringify({
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
          steps: 0,
          subagentMessages: 0,
          subagentMessageBytes: 0,
        }),
        now,
        now,
        now,
      ],
    );
    await db.execute(
      `INSERT INTO ai_thread_entries
        (id, thread_id, user_id, app_id, run_id, sequence, kind, payload_json, created_at)
       VALUES ('stream-retry-input', ?, 1, 'scenario-app', ?, 1, 'user_input', ?, ?)`,
      [threadId, runId, JSON.stringify({ text: 'Say hello world.', artifactRefs: [] }), now],
    );
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES (?, ?, 'root', 'native', ?, 'running', 'runnable', 0, 'owner-stream-retry', ?, ?)`,
      [
        runtimeId,
        runId,
        JSON.stringify({ providerId: 'scenario-provider', modelId: 'scenario-model', configurationVersion: 1 }),
        now,
        now,
      ],
    );

    const conversations = new ConversationService(conversationRepository, clock, null!, null!);
    const context = new ContextService(
      conversations,
      new RecallService(new EmptyRecallRepository(), clock),
      new SkillRegistry(),
      emptyModelContinuations,
      null!,
    );
    const scriptedModel = new ScriptedLanguageModel([
      {
        events: [
          { type: 'message.delta', text: 'hel' },
          { type: 'tool.delta', index: 0, id: 'failed-call', name: 'scenario_read' },
          { type: 'tool.delta', index: 0, argumentsDelta: '{"path":"' },
          { type: 'usage', usage: { inputTokens: 40, outputTokens: 3, cachedInputTokens: 4 } },
        ],
        error: new Error('PROVIDER_STREAM_TRUNCATED'),
      },
      {
        events: [
          { type: 'message.delta', text: 'hello ' },
          { type: 'message.delta', text: 'world' },
          { type: 'usage', usage: { inputTokens: 41, outputTokens: 5, cachedInputTokens: 4 } },
          { type: 'completed', finishReason: 'stop' },
        ],
      },
    ]);
    const providers = new ProviderService(new StaticProviderRepository(benchmarkProvider), scriptedModel, clock);
    const modelRunner = new ModelStepRunner(providers, context, scriptedModel, new ScenarioModelCallLimiter());
    const snapshot = await repository.snapshot(scope, runId);
    assert.ok(snapshot, 'stream retry fixture run must exist');
    const prepared = await modelRunner.prepare(snapshot, scope, [], {});
    const reservedTokens = prepared.contextPlan.estimatedInputTokens + prepared.contextPlan.reservedOutputTokens;
    const begun = await stateCommit.beginModelStep({
      scope,
      runId,
      runtimeId,
      expectedRunVersion: snapshot.version,
      inputWatermark: snapshot.inputRevision,
      reservedTokens,
      estimatedInputTokens: prepared.contextPlan.estimatedInputTokens,
      reservedOutputTokens: prepared.contextPlan.reservedOutputTokens,
      contextWindowTokens: prepared.model.contextWindow,
      now,
    });

    const signal = new AbortController().signal;
    const first = await collectBackendSignals(
      modelRunner.runAttempt(
        snapshot,
        prepared.contextPlan,
        { attemptId: begun.attemptId, attemptIndex: begun.attemptIndex },
        signal,
      ),
    );
    assert.equal((first.result.error as Error | undefined)?.message, 'PROVIDER_STREAM_TRUNCATED');
    assert.equal(modelRunner.shouldRetry(first.result.error, begun.attemptIndex, signal), true);
    assert.ok(first.result.usage, 'failed streamed attempt must retain provider usage');

    const firstMessageSignals = first.signals.filter(
      (item): item is Extract<BackendSignal, { type: 'transient'; eventType: 'message.delta' }> =>
        item.type === 'transient' && item.eventType === 'message.delta',
    );
    const firstToolSignals = first.signals.filter(
      (item): item is Extract<BackendSignal, { type: 'transient'; eventType: 'tool.delta' }> =>
        item.type === 'transient' && item.eventType === 'tool.delta',
    );
    assert.equal(firstMessageSignals.length, 1);
    assert.ok(firstToolSignals.length >= 1);
    for (const transient of [...firstMessageSignals, ...firstToolSignals]) {
      assert.equal(transient.payload.attemptId, begun.attemptId);
      assert.equal(transient.payload.attemptIndex, begun.attemptIndex);
    }

    const failedUsage = first.result.usage!;
    const usageAfterFailed = {
      ...begun.run.usage,
      inputTokens: begun.run.usage.inputTokens + failedUsage.inputTokens,
      outputTokens: begun.run.usage.outputTokens + failedUsage.outputTokens,
      cachedInputTokens: begun.run.usage.cachedInputTokens + failedUsage.cachedInputTokens,
    };
    const retried = await stateCommit.retryModelStep({
      scope,
      runId,
      runtimeId,
      stepId: begun.stepId,
      attemptId: begun.attemptId,
      expectedRunVersion: begun.run.version,
      reservedTokens,
      usage: usageAfterFailed,
      inputTokens: failedUsage.inputTokens,
      outputTokens: failedUsage.outputTokens,
      cachedInputTokens: failedUsage.cachedInputTokens,
      estimatedUsage: false,
      errorCode: 'PROVIDER_STREAM_TRUNCATED',
      now: now + 1,
    });
    assert.notEqual(retried.attemptId, begun.attemptId);
    assert.equal(retried.attemptIndex, begun.attemptIndex + 1);
    const retryEvent = retried.committedEvents.find((event) => event.type === 'model.retrying');
    assert.ok(retryEvent, 'retry must durably announce the new authoritative attempt');
    assert.deepEqual(retryEvent.payload, {
      stepId: begun.stepId,
      previousAttemptId: begun.attemptId,
      attemptId: retried.attemptId,
      attemptIndex: retried.attemptIndex,
      errorCode: 'PROVIDER_STREAM_TRUNCATED',
    });

    const second = await collectBackendSignals(
      modelRunner.runAttempt(
        snapshot,
        prepared.contextPlan,
        { attemptId: retried.attemptId, attemptIndex: retried.attemptIndex },
        signal,
      ),
    );
    assert.equal(second.result.error, undefined);
    assert.equal(second.result.finishReason, 'stop');
    assert.equal(second.result.text, 'hello world');
    assert.ok(second.result.usage, 'successful retry must retain provider usage');
    const secondMessageSignals = second.signals.filter(
      (item): item is Extract<BackendSignal, { type: 'transient'; eventType: 'message.delta' }> =>
        item.type === 'transient' && item.eventType === 'message.delta',
    );
    assert.equal(secondMessageSignals.length, 2, 'same attempt must be allowed to append multiple deltas');
    for (const transient of secondMessageSignals) {
      assert.equal(transient.payload.attemptId, retried.attemptId);
      assert.equal(transient.payload.attemptIndex, retried.attemptIndex);
    }

    interface PresentationState {
      attemptId: string | null;
      attemptIndex: number | null;
      text: string;
    }
    const emptyPresentation = (): PresentationState => ({ attemptId: null, attemptIndex: null, text: '' });
    const applyTransient = (state: PresentationState, transient: BackendSignal): void => {
      if (transient.type !== 'transient' || transient.payload.delegationId) return;
      if (state.attemptId !== transient.payload.attemptId || state.attemptIndex !== transient.payload.attemptIndex) {
        state.attemptId = transient.payload.attemptId;
        state.attemptIndex = transient.payload.attemptIndex;
        state.text = '';
      }
      if (transient.eventType === 'message.delta') state.text += transient.payload.text;
    };
    const applyRetry = (state: PresentationState): void => {
      if (state.attemptId !== begun.attemptId) return;
      state.attemptId = retried.attemptId;
      state.attemptIndex = retried.attemptIndex;
      state.text = '';
    };

    const orderedPresentation = emptyPresentation();
    applyTransient(orderedPresentation, firstMessageSignals[0]!);
    assert.equal(orderedPresentation.text, 'hel');
    applyRetry(orderedPresentation);
    for (const transient of secondMessageSignals) applyTransient(orderedPresentation, transient);
    assert.equal(orderedPresentation.text, 'hello world');

    const racedPresentation = emptyPresentation();
    applyTransient(racedPresentation, firstMessageSignals[0]!);
    applyTransient(racedPresentation, secondMessageSignals[0]!);
    applyRetry(racedPresentation);
    applyTransient(racedPresentation, secondMessageSignals[1]!);
    assert.equal(
      racedPresentation.text,
      'hello world',
      'late durable retry delivery must not erase or concatenate a newer attempt',
    );

    const disconnectedPresentation = emptyPresentation();
    applyTransient(disconnectedPresentation, firstMessageSignals[0]!);
    Object.assign(disconnectedPresentation, emptyPresentation());
    assert.equal(disconnectedPresentation.text, '');
    assert.equal(disconnectedPresentation.attemptId, null);

    const successfulUsage = second.result.usage!;
    const usageAfterSuccess = {
      ...retried.run.usage,
      inputTokens: retried.run.usage.inputTokens + successfulUsage.inputTokens,
      outputTokens: retried.run.usage.outputTokens + successfulUsage.outputTokens,
      cachedInputTokens: retried.run.usage.cachedInputTokens + successfulUsage.cachedInputTokens,
      steps: retried.run.usage.steps + 1,
    };
    const settled = await stateCommit.settleModelStep({
      scope,
      runId,
      runtimeId,
      stepId: begun.stepId,
      attemptId: retried.attemptId,
      expectedRunVersion: retried.run.version,
      assistantEntryId: 'stream-retry-final',
      assistantText: second.result.text,
      usage: usageAfterSuccess,
      inputTokens: successfulUsage.inputTokens,
      outputTokens: successfulUsage.outputTokens,
      cachedInputTokens: successfulUsage.cachedInputTokens,
      estimatedUsage: false,
      finishReason: 'stop',
      terminalStatus: 'completed_unverified',
      now: now + 2,
    });
    assert.equal(settled.run.status, 'completed_unverified');

    const failedAttempt = await db.queryOne<{
      status: string;
      attempt_index: number;
      input_tokens: number | null;
      output_tokens: number | null;
      error_code: string | null;
    }>(
      `SELECT status, attempt_index, input_tokens, output_tokens, error_code
       FROM agent_model_attempts WHERE id = ?`,
      [begun.attemptId],
    );
    const successfulAttempt = await db.queryOne<{
      status: string;
      attempt_index: number;
      input_tokens: number | null;
      output_tokens: number | null;
      error_code: string | null;
    }>(
      `SELECT status, attempt_index, input_tokens, output_tokens, error_code
       FROM agent_model_attempts WHERE id = ?`,
      [retried.attemptId],
    );
    assert.deepEqual(failedAttempt, {
      status: 'failed',
      attempt_index: 1,
      input_tokens: 40,
      output_tokens: 3,
      error_code: 'PROVIDER_STREAM_TRUNCATED',
    });
    assert.deepEqual(successfulAttempt, {
      status: 'completed',
      attempt_index: 2,
      input_tokens: 41,
      output_tokens: 5,
      error_code: null,
    });

    const ledger = await conversationRepository.readEntries(scope, threadId, 20);
    const assistantEntries = ledger.items.filter((entry) => entry.kind === 'assistant_message');
    assert.equal(assistantEntries.length, 1);
    const assistantPayload = assistantEntries[0]?.payload;
    assert.ok(assistantPayload && typeof assistantPayload === 'object' && !Array.isArray(assistantPayload));
    assert.equal((assistantPayload as Record<string, unknown>).text, 'hello world');
    assert.equal(JSON.stringify(assistantPayload).includes('helhello'), false);

    const transientDurableCount = await db.queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count FROM agent_events
       WHERE run_id = ? AND type IN ('message.delta', 'tool.delta')`,
      [runId],
    );
    assert.equal(transientDurableCount?.count, 0, 'ephemeral deltas must never become durable run events');
    const finalSnapshot = await repository.snapshot(scope, runId);
    assert.ok(finalSnapshot);
    assert.equal(finalSnapshot.usage.inputTokens, 81);
    assert.equal(finalSnapshot.usage.outputTokens, 8);
    assert.equal(finalSnapshot.usage.cachedInputTokens, 8);
    scriptedModel.assertConsumed();

    return [
      { name: 'authoritative_attempts', value: 2, unit: 'attempts' },
      { name: 'failed_attempt_partial_prefix_bytes', value: Buffer.byteLength('hel'), unit: 'bytes' },
      { name: 'successful_attempt_message_deltas', value: secondMessageSignals.length, unit: 'events' },
      { name: 'tool_deltas_with_attempt_identity', value: firstToolSignals.length, unit: 'events' },
      { name: 'durable_transient_delta_rows', value: transientDurableCount?.count ?? -1, unit: 'rows' },
      { name: 'final_assistant_messages', value: assistantEntries.length, unit: 'messages' },
    ];
  } finally {
    await db.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

const agentLifecycleNotificationScenario: Scenario = async () => {
  const benchmark: AgentBenchmarkCase = {
    id: 'coding',
    prompt: 'Internal prompt that must never reach notifications.',
    toolName: 'scenario_notification_read',
    toolArgumentsJson: '{}',
    toolDescription: 'notification fixture',
    toolInputSchema: { type: 'object', additionalProperties: false },
    toolSummary: 'done',
    finalText: 'done',
    usage: [
      { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
      { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
    ],
  };
  const run = benchmarkSnapshot(benchmark, { userId: 1, appId: 'notification-app' });
  const published: Array<{ event: string; details: Record<string, unknown> | string | undefined }> = [];
  let rejectPublishes = false;
  const bridge = new AgentNotificationBridge(
    {
      publish: async (event, details) => {
        published.push({ event, details });
        if (rejectPublishes) throw new Error('SCENARIO_NOTIFICATION_DELIVERY_FAILED');
      },
    },
    {
      getThread: async () => ({
        id: run.threadId,
        appId: run.appId,
        title: 'Safe thread title',
        titleSource: 'manual',
        version: 1,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        latestRunId: run.id,
      }),
    },
  );
  const event = (sequence: number, type: string, payload: JsonValue) => ({
    eventId: `notification-event-${sequence}`,
    runId: run.id,
    sequence,
    schemaVersion: 1 as const,
    type,
    payload,
    occurredAt: run.createdAt + sequence,
  });

  const completedEvent = event(1, 'run.status_changed', { from: 'running', to: 'completed_unverified' });
  await bridge.project({ ...run, status: 'completed_unverified' }, [completedEvent]);
  await bridge.project({ ...run, status: 'completed_unverified' }, [completedEvent]);
  assert.equal(
    published.filter((item) => item.event === 'AGENT_RUN_COMPLETED').length,
    1,
    'one durable completion transition must project at most once even if the observer is called twice',
  );

  await bridge.project({ ...run, status: 'failed' }, [
    event(2, 'run.error', {
      code: 'MODEL_PROVIDER_FAILED',
      prompt: benchmark.prompt,
      toolRawOutput: 'SECRET_TOOL_OUTPUT',
      credential: 'SECRET_CREDENTIAL',
      continuation: 'SECRET_CONTINUATION',
      reasoning: 'SECRET_REASONING',
    }),
    event(3, 'run.status_changed', { from: 'running', to: 'failed' }),
  ]);
  await bridge.project({ ...run, status: 'interrupted' }, [
    event(4, 'run.interrupted', { reason: 'backend_restart', errorCode: 'EXECUTION_INTERRUPTED' }),
    event(5, 'run.status_changed', { from: 'running', to: 'interrupted' }),
  ]);
  await bridge.project({ ...run, status: 'awaiting_approval' }, [
    event(6, 'approval.requested', {
      approvalId: 'approval-safe-id',
      toolCallId: 'tool-private-id',
      operationHash: 'PRIVATE_OPERATION_HASH',
      expiresAt: run.createdAt + 600,
      risk: 'mutate',
    }),
    event(7, 'run.status_changed', { from: 'running', to: 'awaiting_approval' }),
  ]);
  await bridge.project({ ...run, status: 'awaiting_input' }, [
    event(8, 'input.requested', {
      requestId: 'input-safe-id',
      runtimeId: 'runtime-private-id',
      toolCallId: 'tool-private-id',
      questionCount: 2,
      questions: ['SECRET QUESTION TEXT'],
    }),
    event(9, 'run.status_changed', { from: 'running', to: 'awaiting_input' }),
  ]);
  await bridge.project({ ...run, status: 'awaiting_input' }, [
    event(10, 'run.loop_detected', { reason: 'repeated_no_progress', runtimeId: 'private-runtime' }),
    event(11, 'run.status_changed', { from: 'running', to: 'awaiting_input' }),
  ]);
  await bridge.project({ ...run, status: 'awaiting_budget' }, [
    event(12, 'budget.increase_requested', {
      reason: 'step_limit',
      currentSteps: 100,
      requestedSteps: 101,
    }),
    event(13, 'run.status_changed', { from: 'running', to: 'awaiting_budget' }),
  ]);

  assert.equal(published.filter((item) => item.event === 'AGENT_RUN_FAILED').length, 1);
  assert.equal(published.filter((item) => item.event === 'AGENT_RUN_INTERRUPTED').length, 1);
  assert.equal(published.filter((item) => item.event === 'AGENT_APPROVAL_REQUIRED').length, 1);
  assert.equal(published.filter((item) => item.event === 'AGENT_INPUT_REQUIRED').length, 1);
  assert.equal(published.filter((item) => item.event === 'AGENT_ATTENTION_REQUIRED').length, 2);
  assert.equal(
    published.some((item) => item.event.includes('BUDGET') || item.event.includes('TOKEN')),
    false,
    'step/active-time fuses must use generic attention rather than budget/token-specific notification events',
  );

  const serialized = JSON.stringify(published.map((item) => item.details));
  for (const forbidden of [
    benchmark.prompt,
    'SECRET_TOOL_OUTPUT',
    'SECRET_CREDENTIAL',
    'SECRET_CONTINUATION',
    'SECRET_REASONING',
    'SECRET QUESTION TEXT',
    'PRIVATE_OPERATION_HASH',
    'tool-private-id',
    'runtime-private-id',
    'private-runtime',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `notification details must not contain ${forbidden}`);
  }
  assert.ok(serialized.includes('Safe thread title'));
  assert.ok(serialized.includes(run.id));
  assert.ok(serialized.includes(run.threadId));

  rejectPublishes = true;
  await assert.doesNotReject(() =>
    bridge.project({ ...run, status: 'failed' }, [
      event(14, 'run.error', { code: 'SECOND_FAILURE' }),
      event(15, 'run.status_changed', { from: 'running', to: 'failed' }),
    ]),
  );

  let channelSends = 0;
  const setting = {
    id: 1,
    channelType: 'webhook' as const,
    name: 'scenario',
    enabled: true,
    config: { url: 'https://notification.invalid' },
    enabledEvents: ['AGENT_RUN_COMPLETED' as const],
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
  const notificationService = new NotificationService(
    {
      listEnabledFor: async (notificationEvent: string) =>
        notificationEvent === 'AGENT_RUN_COMPLETED' ? [setting] : [],
    } as never,
    {
      send: async () => {
        channelSends += 1;
        throw new Error('SCENARIO_CHANNEL_FAILURE');
      },
    } as never,
    {
      prepare: (_setting: unknown, payload: unknown) => ({
        channelType: 'webhook',
        config: { url: 'https://notification.invalid' },
        body: '{}',
        payload,
      }),
    } as never,
    {
      defaultLocale: 'en-US',
      resolveLocale: () => 'en-US',
    } as never,
    { getSetting: async () => null } as never,
  );
  await assert.doesNotReject(() => notificationService.publish('AGENT_RUN_COMPLETED', { runId: run.id }));
  assert.equal(channelSends, 1, 'enabled existing notification settings must receive the Agent event');
  await notificationService.publish('AGENT_RUN_FAILED', { runId: run.id });
  assert.equal(channelSends, 1, 'disabled Agent events must remain filtered by existing enabledEvents settings');

  return [
    { name: 'agent_notification_transition_duplicates', value: 0, unit: 'notifications' },
    { name: 'agent_notification_sensitive_fields', value: 0, unit: 'fields' },
    { name: 'agent_notification_delivery_failures_blocking', value: 0, unit: 'runs' },
  ];
};

const planExecutionModeScenario: Scenario = async () => {
  const scope: Scope = { userId: 1, appId: 'plan-mode-app' };
  const cryptoHash = { sha256Utf8: (value: string) => createHash('sha256').update(value, 'utf8').digest('hex') };
  const catalog = new ToolCatalog();
  const tool = (name: string, riskClass: 'read' | 'mutate'): AgentTool => ({
    descriptor: {
      name,
      version: '1',
      description: `${riskClass} fixture`,
      inputSchema: { type: 'object', additionalProperties: false },
      riskClass,
    },
    inspect: async (input, context, policyRevision) => ({
      toolName: name,
      toolVersion: '1',
      normalizedArguments: input,
      target: {
        kind: 'run',
        targetIdentity: `run:${context.runId}:${name}`,
        endpoint: `run:${context.runId}`,
        loginUser: `agent-runtime:${context.agentRuntimeId}`,
        configurationHash: `plan-${name}`,
      },
      resourceKeys: [],
      risk: riskClass,
      mutation: riskClass === 'mutate',
      operationHash: `plan-${name}`,
      operationHashVersion: 1,
      preconditions: [],
      policyRevision,
      inputRevision: context.inputRevision,
    }),
    execute: async () => ({
      ok: true,
      summary: `${name} executed`,
      artifactRefs: [],
      truncated: false,
      outcome: 'confirmed',
      verification: { status: 'verified', summary: 'fixture', evidenceRefs: [] },
    }),
  });
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'scenario.plan-mode',
    tools: [
      tool('scenario_plan_read', 'read'),
      tool('scenario_plan_mutation', 'mutate'),
      createPlanUpdateTool(null!, null!, cryptoHash),
      createRequestUserInputTool(cryptoHash),
    ],
  });
  const capabilities = {
    authorize: async () => ({ allowed: true as const, policyRevision: 1 }),
  } as unknown as AppCapabilityBroker;
  const executor = new ToolExecutor(catalog, capabilities);
  const runner = new ToolCallRunner(catalog, executor, { decide: () => ({ action: 'allow' }) } as never, null!, null!);
  const planSchemas = runner.schemas(scope, undefined, 'plan');
  assert.deepEqual(
    planSchemas.map((item) => item.name).sort(),
    ['plan_update', 'request_user_input', 'scenario_plan_read'],
    'plan mode model surface must retain read/control tools and exclude mutation tools',
  );

  const context: ToolContext = {
    ...scope,
    actor: { kind: 'agent', userId: 1, appId: scope.appId, runId: 'plan-run', agentRuntimeId: 'plan-runtime' },
    runId: 'plan-run',
    agentRuntimeId: 'plan-runtime',
    connectionIds: [],
    environment: null,
    stepId: 'plan-step',
    signal: new AbortController().signal,
    deadlineAt: 1_800_900_000,
    maxOutputBytes: 64 * 1024,
    inputRevision: 1,
  };
  await assert.rejects(
    () =>
      runner.inspect(
        context,
        { providerCallId: 'forged', name: 'scenario_plan_mutation', argumentsJson: '{}' },
        'plan',
      ),
    /PLAN_MODE_TOOL_FORBIDDEN/,
    'a forged mutation tool call must fail closed even when the tool exists in the catalog',
  );

  const parsed = parseCreateRunRequest({
    schemaVersion: 1,
    threadId: randomUUID(),
    input: { text: 'Prepare a plan.', artifactRefs: [] },
    agentDefinitionId: 'scenario-agent',
    model: { providerId: randomUUID(), modelId: 'scenario-model', configurationVersion: 1 },
    approvalMode: 'full_access',
    executionMode: 'plan',
    connectionIds: [],
  });
  assert.equal(parsed.executionMode, 'plan');
  assert.equal(parsed.approvalMode, 'full_access', 'executionMode must remain orthogonal to approvalMode');
  assert.throws(
    () =>
      parseCreateRunRequest({
        schemaVersion: 1,
        threadId: randomUUID(),
        input: { text: 'Execute normally.', artifactRefs: [] },
        agentDefinitionId: 'scenario-agent',
        model: { providerId: randomUUID(), modelId: 'scenario-model', configurationVersion: 1 },
        approvalMode: 'ask',
        connectionIds: [],
      }),
    /VALIDATION_FAILED/,
    'omitted executionMode must fail closed instead of selecting an implicit execution mode',
  );

  const planBenchmark: AgentBenchmarkCase = {
    id: 'coding',
    prompt: 'Prepare a durable implementation plan only.',
    toolName: 'scenario_plan_read',
    toolArgumentsJson: '{}',
    toolDescription: 'read fixture',
    toolInputSchema: { type: 'object', additionalProperties: false },
    toolSummary: 'read complete',
    finalText: 'plan ready',
    usage: [
      { inputTokens: 10, outputTokens: 2, cachedInputTokens: 0 },
      { inputTokens: 10, outputTokens: 2, cachedInputTokens: 0 },
    ],
  };
  const snapshot = benchmarkSnapshot(planBenchmark, scope);
  snapshot.definition.executionMode = 'plan';
  assert.equal(parseRunDefinition(JSON.stringify(snapshot.definition)).executionMode, 'plan');
  assert.throws(
    () => parseRunDefinition(JSON.stringify({ ...snapshot.definition, executionMode: 'unsafe' })),
    /AGENT_DURABLE_STATE_INVALID/,
    'durable executionMode decoder must fail closed on unknown values',
  );
  const inputEntry: LedgerEntryView = {
    id: 'plan-mode-input',
    threadId: snapshot.threadId,
    runId: snapshot.id,
    sequence: 1,
    kind: 'user_input',
    payload: { text: planBenchmark.prompt, artifactRefs: [] },
    createdAt: snapshot.createdAt,
  };
  const conversations = new ConversationService(new StaticConversationRepository([inputEntry]), clock, null!, null!);
  const modelContext = new ContextService(
    conversations,
    new RecallService(new EmptyRecallRepository(), clock),
    new SkillRegistry(),
    emptyModelContinuations,
    null!,
  );
  const scriptedModel = new ScriptedLanguageModel([
    {
      assertRequest: (request) => {
        assert.deepEqual(
          request.tools.map((item) => item.name).sort(),
          ['plan_update', 'request_user_input', 'scenario_plan_read'],
          'the actual model request must not contain mutation tool schemas in plan mode',
        );
      },
      events: [
        { type: 'usage', usage: { inputTokens: 10, outputTokens: 2, cachedInputTokens: 0 } },
        { type: 'completed', finishReason: 'stop' },
      ],
    },
  ]);
  const providers = new ProviderService(new StaticProviderRepository(benchmarkProvider), scriptedModel, clock);
  const modelRunner = new ModelStepRunner(providers, modelContext, scriptedModel, new ScenarioModelCallLimiter());
  const prepared = await modelRunner.prepare(snapshot, scope, planSchemas, {});
  const modelResult = await collectBackendSignals(
    modelRunner.runAttempt(
      snapshot,
      prepared.contextPlan,
      { attemptId: 'plan-attempt', attemptIndex: 1 },
      context.signal,
    ),
  );
  assert.equal(modelResult.result.error, undefined);
  scriptedModel.assertConsumed();

  const gate = completionGateDecision(
    {
      definition: { executionMode: 'plan' },
      plan: {
        schemaVersion: 1,
        revision: 1,
        items: [
          {
            id: 'implement',
            title: 'Implement after approval',
            detail: null,
            status: 'pending',
            dependsOn: [],
            evidenceRefs: [],
          },
        ],
      },
    } as unknown as RunSnapshot,
    { tools: [], readyEvidenceRefs: [], gateBlocksSinceToolProgress: 0 },
    'Prepare a plan.',
  );
  assert.equal(
    gate.kind,
    'complete',
    'pending durable plan items are the output of a plan-only Run, not unfinished execution',
  );

  const providerId = randomUUID();
  const threadId = randomUUID();
  const sourceRunId = randomUUID();
  const resolvedModel = resolveProviderModelConfig({
    id: 'plan-lineage-model',
    capabilityOverrides: { contextWindow: 8_192, maxOutputTokens: 1_024, supportsTools: true },
  });
  const sourcePlan: RunSnapshot['plan'] = {
    schemaVersion: 1,
    revision: 2,
    items: [
      {
        id: 'implementation',
        title: 'Implement the approved change',
        detail: 'Execute in a separate Run.',
        status: 'pending',
        dependsOn: [],
        evidenceRefs: ['artifact:plan-evidence'],
      },
    ],
  };
  const sourcePlanRun = {
    ...snapshot,
    ...scope,
    id: sourceRunId,
    threadId,
    status: 'completed_unverified',
    completedAt: 1_800_000_100,
    definition: {
      ...snapshot.definition,
      executionMode: 'plan',
      model: { providerId, modelId: resolvedModel.id, configurationVersion: 1 },
    },
    plan: sourcePlan,
    goal: { text: 'Ship the planned change.', revision: 1, updatedAt: 1_800_000_000 },
  } as RunSnapshot;
  let createRecord: AtomicCreateRun | null = null;
  const lineageRunService = new RunService(
    {
      get: async () => ({
        revision: 1,
        requestedSettings: { model: { fallbackModels: [] } },
        effectiveSettings: { feature: { enabled: true } },
      }),
    } as never,
    {
      get: async () => ({
        activeVersion: '1.0.0',
        desiredState: 'enabled',
        observedState: 'running',
        acceptNewRuns: true,
        policyRevision: 1,
      }),
    } as never,
    { get: async () => ({ id: providerId, enabled: true, version: 1, models: [resolvedModel] }) } as never,
    {
      get: async () => ({
        version: 1,
        effective: {
          maxRunSteps: 100,
          maxActiveExecutionSeconds: 3_600,
          toolTimeoutSeconds: 120,
          maxToolOutputBytes: 1_048_576,
          maxRecallItems: 5,
          maxRecallBytes: 8_192,
          maxSubagentMessages: 100,
          maxSubagentMessageBytes: 1_048_576,
          contextCompactionMode: 'balanced',
          contextProfile: 'normal',
        },
      }),
    } as never,
    { require: () => ({ id: 'scenario-agent', version: '1.0.0', requiredModelCapabilities: [] }) } as never,
    async () => {
      throw new Error('SCENARIO_UNEXPECTED_ENVIRONMENT');
    },
    {
      createRun: async (record: AtomicCreateRun) => {
        createRecord = record;
        return {
          run: {
            ...sourcePlanRun,
            id: record.runId,
            parentRunId: record.parentRunId ?? null,
            status: 'created',
            completedAt: null,
            definition: record.definition,
            plan: record.initialPlan ?? { schemaVersion: 1, revision: 0, items: [] },
            goal: record.initialGoal ?? { text: null, revision: 0, updatedAt: null },
          },
          inputSequence: 1,
          replayed: false,
        };
      },
    } as never,
    { snapshot: async (_scope: Scope, runId: string) => (runId === sourceRunId ? sourcePlanRun : null) } as never,
    clock,
  );
  const executeFromPlan = await lineageRunService.create(scope, {
    threadId,
    input: { text: 'Execute the approved plan.', artifactRefs: [] },
    agentDefinitionId: 'scenario-agent',
    model: { providerId, modelId: resolvedModel.id, configurationVersion: 1 },
    approvalMode: 'full_access',
    executionMode: 'execute',
    plannedFromRunId: sourceRunId,
    connectionIds: [],
    command: { key: randomUUID(), requestId: randomUUID() },
  });
  assert.ok(createRecord);
  assert.equal(createRecord.parentRunId, sourceRunId, 'parentRunId remains the single durable Run lineage authority');
  assert.deepEqual(
    createRecord.initialPlan,
    sourcePlan,
    'execute Run must inherit the durable plan including evidence refs',
  );
  assert.equal(
    createRecord.initialGoal?.text,
    sourcePlanRun.goal.text,
    'execute Run inherits the plan Run goal when no new goal is supplied',
  );
  assert.equal(executeFromPlan.definition.executionMode, 'execute');
  assert.equal(
    executeFromPlan.definition.approvalMode,
    'full_access',
    'plan confirmation must not override execute Run approval mode',
  );
  await assert.rejects(
    () =>
      lineageRunService.create(scope, {
        threadId,
        input: { text: 'Invalid chained plan.', artifactRefs: [] },
        agentDefinitionId: 'scenario-agent',
        model: { providerId, modelId: resolvedModel.id, configurationVersion: 1 },
        approvalMode: 'ask',
        executionMode: 'plan',
        plannedFromRunId: sourceRunId,
        connectionIds: [],
        command: { key: randomUUID(), requestId: randomUUID() },
      }),
    /VALIDATION_FAILED/,
    'plannedFromRunId is only valid when starting a separate execute Run',
  );

  return [
    { name: 'plan_model_surface_mutations', value: 0, unit: 'tools' },
    { name: 'forged_plan_mutations_allowed', value: 0, unit: 'tools' },
    { name: 'plan_control_tools_available', value: 2, unit: 'tools' },
    { name: 'planned_execute_lineage_links', value: createRecord?.parentRunId === sourceRunId ? 1 : 0, unit: 'runs' },
  ];
};

const defaultPolicyAuthorityScenario: Scenario = async () => {
  const defaults = AGENT_DEFAULTS as unknown as Record<string, unknown>;
  for (const key of [
    'approvalTtlSeconds',
    'leaseTtlSeconds',
    'leaseRenewSeconds',
    'estimateMargin',
    'maxConcurrentToolCalls',
  ] as const) {
    assert.equal(key in defaults, false, `AGENT_DEFAULTS.${key} must not remain as a dead policy authority`);
  }
  assert.deepEqual(
    Object.keys(defaults).sort(),
    ['minFreeDiskBytes', 'modelRetryCount', 'settings'],
    'AGENT_DEFAULTS top-level policy bag must contain only live runtime defaults plus settings',
  );
  assert.equal(typeof defaults.minFreeDiskBytes, 'number', 'artifact free-space default remains a live authority');
  assert.equal(typeof defaults.modelRetryCount, 'number', 'model retry count remains a live authority');
  assert.equal(
    TOOL_APPROVAL_TTL_SECONDS,
    600,
    'approval producer/validator contract keeps the established 10 minute TTL',
  );
  assert.equal(LEASE_RENEW_INTERVAL_MS, 10_000, 'all live lease renewal paths share one 10 second cadence');
  assert.equal(toolLeaseTtlSeconds(1), 30, 'Agent tool leases retain the minimum 30 second TTL');
  assert.equal(toolLeaseTtlSeconds(60), 75, 'Agent tool lease TTL remains tool timeout plus grace');
  assert.equal(toolLeaseTtlSeconds(300), 300, 'Agent tool lease TTL remains capped at 300 seconds');
  return [
    { name: 'dead_top_level_defaults', value: 0, unit: 'fields' },
    { name: 'live_top_level_defaults', value: 2, unit: 'fields' },
    { name: 'approval_ttl_authorities', value: 1, unit: 'authorities' },
    { name: 'lease_renewal_cadence_authorities', value: 1, unit: 'authorities' },
    { name: 'agent_tool_lease_policy_cases', value: 3, unit: 'cases' },
  ];
};

const budgetSettingsDeadFieldScenario: Scenario = async () => {
  const deadSettingsKeys = ['maxContextTokens', 'maxOutputTokens', 'maxRawToolBytes'] as const;
  const assertDeadSettingsAbsent = (value: unknown, label: string): void => {
    assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
    const settings = value as Record<string, unknown>;
    for (const sectionName of ['budget', 'hardLimits'] as const) {
      const section = settings[sectionName];
      assert.ok(section && typeof section === 'object' && !Array.isArray(section), `${label}.${sectionName} missing`);
      for (const key of deadSettingsKeys) {
        assert.equal(
          key in (section as Record<string, unknown>),
          false,
          `${label}.${sectionName}.${key} must not remain a saveable Agent setting`,
        );
      }
    }
  };

  assertDeadSettingsAbsent(createDefaultAgentSettings(), 'defaults');
  const currentDefaults = createDefaultAgentSettings() as unknown as Record<string, unknown>;
  const legacyPayload = {
    ...currentDefaults,
    budget: {
      ...(currentDefaults.budget as Record<string, unknown>),
      maxContextTokens: 1_111,
      maxOutputTokens: 222,
      maxRawToolBytes: 333,
    },
    hardLimits: {
      ...(currentDefaults.hardLimits as Record<string, unknown>),
      maxContextTokens: 4_444,
      maxOutputTokens: 555,
      maxRawToolBytes: 666,
    },
  };
  assert.throws(
    () => normalizeRequestedSettings(legacyPayload),
    /VALIDATION_FAILED/,
    'settings with removed budget fields must fail closed instead of being normalized',
  );

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-budget-dead-fields-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'budget-dead-fields.sqlite', nodeEnv: 'test' });
  try {
    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'budget-dead-user', 'not-used')");
    await db.execute(`INSERT INTO agent_settings (user_id, value_json, revision, updated_at) VALUES (1, ?, 1, 1)`, [
      JSON.stringify(createDefaultAgentSettings()),
    ]);
    const repository = new SqliteAgentSettingsRepository(db);
    const service = new AgentSettingsService(
      repository,
      {
        get: async () => null,
        save: async () => undefined,
        delete: async () => undefined,
        deleteExpired: async () => undefined,
      } as never,
      { read: async () => ({ artifactUsedBytes: 0, artifactReservedBytes: 0, executingRuntimes: 0 }) } as never,
      { nowUnixSeconds: () => 2 },
    );
    const loaded = await service.get(1);
    assertDeadSettingsAbsent(loaded.requestedSettings, 'GET requested settings');
    assertDeadSettingsAbsent(loaded.effectiveSettings, 'GET effective settings');
    assertDeadSettingsAbsent({ budget: {}, hardLimits: loaded.hardLimits }, 'GET hard limits');

    for (const key of deadSettingsKeys) {
      await assert.rejects(
        () => service.patch(1, { budget: { [key]: 999 } }, 1),
        /VALIDATION_FAILED/,
        `removed budget.${key} patch surface must fail closed`,
      );
      await assert.rejects(
        () => service.previewHardLimits(1, { [key]: 999 }, 1),
        /VALIDATION_FAILED/,
        `removed hardLimits.${key} preview surface must fail closed`,
      );
    }

    let storedPolicy = {
      key: 'agent.execution-policy.v1',
      value: {
        schemaVersion: 1,
        overrides: { maxRunSteps: 42, maxRawToolBytes: 777 },
      } as JsonValue,
      bytes: 1,
      version: 1,
      updatedAt: 1,
    };
    const executionPolicies = new AgentExecutionPolicyService(
      {
        get: async () => storedPolicy,
        put: async (_scope: Scope, key: string, value: JsonValue, expectedVersion: number | null) => {
          assert.equal(expectedVersion, storedPolicy.version);
          storedPolicy = { key, value, bytes: 1, version: storedPolicy.version + 1, updatedAt: 2 };
          return storedPolicy;
        },
        delete: async () => false,
      },
      service,
    );
    await assert.rejects(
      () => executionPolicies.get({ userId: 1, appId: 'scenario-app' }),
      /VALIDATION_FAILED/,
      'stored execution policy with removed fields must fail closed',
    );
    storedPolicy = {
      ...storedPolicy,
      value: { schemaVersion: 1, overrides: { maxRunSteps: 42 } } as JsonValue,
    };
    const currentPolicy = await executionPolicies.get({ userId: 1, appId: 'scenario-app' });
    assert.equal(currentPolicy.effective.maxRunSteps, 42);
    await assert.rejects(
      () => executionPolicies.replace({ userId: 1, appId: 'scenario-app' }, { maxRawToolBytes: 999 }, 1),
      /VALIDATION_FAILED/,
      'new app execution policy writes must reject maxRawToolBytes',
    );
    await executionPolicies.replace({ userId: 1, appId: 'scenario-app' }, { maxRunSteps: 43 }, 1);
    const persistedPolicyOverrides = (storedPolicy.value as { overrides?: Record<string, unknown> }).overrides ?? {};
    assert.equal(
      'maxRawToolBytes' in persistedPolicyOverrides,
      false,
      'current policy writes must contain only current fields',
    );

    const legacyRunBudget = {
      maxContextTokens: 16_384,
      maxOutputTokens: 4_096,
      maxRunSteps: 80,
      maxActiveExecutionSeconds: 1_800,
      toolTimeoutSeconds: 60,
      maxToolOutputBytes: 65_536,
      maxRawToolBytes: 10_485_760,
      maxRecallItems: 5,
      maxRecallBytes: 8_192,
      maxSubagentMessages: 1_000,
      maxSubagentMessageBytes: 1_048_576,
      contextPolicy: freezeRunContextPolicy('normal'),
      contextCompactionMode: 'balanced',
      revision: 1,
    };
    assert.throws(
      () => parseRunBudget(JSON.stringify(legacyRunBudget)),
      /AGENT_DURABLE_STATE_INVALID/,
      'durable Run budget with a removed field must fail closed',
    );
    const {
      maxRawToolBytes: _removedRawQuota,
      maxContextTokens: _removedContextCapability,
      maxOutputTokens: _removedOutputCapability,
      ...currentRunBudget
    } = legacyRunBudget;
    assert.deepEqual(
      parseRunBudget(JSON.stringify(currentRunBudget)),
      currentRunBudget,
      'new durable Run budgets without removed capability/quota fields must decode',
    );
    assert.throws(
      () =>
        parseRunBudget(
          JSON.stringify({
            ...currentRunBudget,
            contextPolicy: { ...currentRunBudget.contextPolicy, effectiveWindowPercent: 101 },
          }),
        ),
      /AGENT_DURABLE_STATE_INVALID/,
      'durable context policy percentages outside 1-100 must fail closed',
    );
  } finally {
    await db.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }

  return [
    { name: 'saveable_dead_budget_fields', value: 0, unit: 'fields' },
    { name: 'removed_raw_quota_runtime_owners', value: 0, unit: 'owners' },
    { name: 'removed_budget_field_rejections', value: 1, unit: 'runs' },
  ];
};

const providerSettingsDeadFieldScenario: Scenario = async () => {
  const defaults = createDefaultAgentSettings() as unknown as Record<string, unknown>;
  assert.equal('safety' in defaults, false, 'new Agent settings must not serialize the removed safety section');

  const legacyPayload = {
    ...createDefaultAgentSettings(),
    safety: { providerPrivateNetworkExceptions: ['127.0.0.1', 'internal.example'] },
  };
  assert.throws(
    () => normalizeRequestedSettings(legacyPayload),
    /VALIDATION_FAILED/,
    'settings with the removed safety section must fail closed',
  );

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-settings-dead-field-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'settings-dead-field.sqlite', nodeEnv: 'test' });
  try {
    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'settings-user', 'not-used')");
    await db.execute(`INSERT INTO agent_settings (user_id, value_json, revision, updated_at) VALUES (1, ?, 1, 1)`, [
      JSON.stringify(legacyPayload),
    ]);

    const repository = new SqliteAgentSettingsRepository(db);
    const service = new AgentSettingsService(
      repository,
      {
        get: async () => null,
        save: async () => undefined,
        delete: async () => undefined,
        deleteExpired: async () => undefined,
      } as never,
      { read: async () => ({ artifactUsedBytes: 0, artifactReservedBytes: 0 }) } as never,
      { nowUnixSeconds: () => 2 },
    );
    await assert.rejects(
      () => service.get(1),
      /VALIDATION_FAILED/,
      'persisted settings with the removed safety section must fail closed',
    );
    await db.execute('UPDATE agent_settings SET value_json = ? WHERE user_id = 1', [
      JSON.stringify(createDefaultAgentSettings()),
    ]);
    const loaded = await service.get(1);
    assert.equal('safety' in (loaded.requestedSettings as unknown as Record<string, unknown>), false);
    assert.equal('safety' in (loaded.effectiveSettings as unknown as Record<string, unknown>), false);

    await assert.rejects(
      () => service.patch(1, { safety: { providerPrivateNetworkExceptions: ['127.0.0.1'] } }, 1),
      /VALIDATION_FAILED/,
      'removed safety patch surface must fail closed',
    );
  } finally {
    await db.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

const providerFallbackChainScenario: Scenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-provider-fallback-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'provider-fallback.sqlite', nodeEnv: 'test' });
  const stateCommit = new SqliteStateCommitAdapter(db);
  const repository = new SqliteRunRepository(db);
  const conversationRepository = new SqliteConversationRepository(db);
  const now = 1_800_000_000;
  const runId = 'provider-fallback-run';
  const threadId = 'provider-fallback-thread';
  const runtimeId = 'provider-fallback-runtime';
  const primaryRef = { providerId: 'primary-provider', modelId: 'primary-model', configurationVersion: 3 };
  const fallbackRef = { providerId: 'fallback-provider', modelId: 'fallback-model', configurationVersion: 7 };

  const primaryPersisted: PersistedProviderView = {
    id: primaryRef.providerId,
    kind: 'openai-compatible',
    displayName: 'Primary provider',
    baseUrl: 'http://primary.invalid/v1',
    protocol: 'responses',
    hasCredential: false,
    credentialRevision: 0,
    models: [
      {
        id: primaryRef.modelId,
        capabilityOverrides: {
          contextWindow: 8_192,
          maxOutputTokens: 1_024,
          supportsTools: true,
          supportsImageInput: true,
          reasoning: { supportedEfforts: ['none', 'medium'], defaultEffort: 'medium' },
        },
      },
    ],
    liveCapabilities: [],
    enabled: true,
    version: primaryRef.configurationVersion,
    createdAt: now,
    updatedAt: now,
  };
  const fallbackPersisted: PersistedProviderView = {
    id: fallbackRef.providerId,
    kind: 'openai-compatible',
    displayName: 'Fallback provider',
    baseUrl: 'http://fallback.invalid/v1',
    protocol: 'responses',
    hasCredential: false,
    credentialRevision: 0,
    models: [
      {
        id: fallbackRef.modelId,
        capabilityOverrides: {
          contextWindow: 4_096,
          maxOutputTokens: 512,
          supportsTools: true,
          supportsImageInput: true,
          reasoning: { supportedEfforts: ['none', 'medium'], defaultEffort: 'medium' },
        },
      },
    ],
    liveCapabilities: [],
    enabled: true,
    version: fallbackRef.configurationVersion,
    createdAt: now,
    updatedAt: now,
  };
  const primaryCapabilities = snapshotProviderModelCapabilities(
    resolveProviderModelConfig(primaryPersisted.models[0]!),
  );
  const fallbackCapabilities = snapshotProviderModelCapabilities(
    resolveProviderModelConfig(fallbackPersisted.models[0]!),
  );
  const frozenFallbackRoute = { model: fallbackRef, modelCapabilities: fallbackCapabilities };

  try {
    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'fallback-user', 'not-used')");
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
       VALUES (1, 'scenario-app', '1.0.0', 'enabled', 'running', 1, ?, ?)`,
      [now, now],
    );
    await db.execute(
      `INSERT INTO ai_threads
        (id, user_id, app_id, title, title_source, next_sequence, created_at, updated_at)
       VALUES (?, 1, 'scenario-app', 'provider fallback', 'manual', 2, ?, ?)`,
      [threadId, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runs
        (id, user_id, app_id, thread_id, status, goal_status, goal_text, goal_revision, goal_updated_at,
         verification_status, budget_json, definition_json, plan_json, usage_json,
         active_execution_started_at, executing_runtime_count, consumed_input_sequence, input_revision,
         created_at, started_at, updated_at)
       VALUES (?, 1, 'scenario-app', ?, 'running', 'in_progress', 'Finish through fallback.', 1, ?,
               'not_started', ?, ?, ?, ?, NULL, 0, 0, 1, ?, ?, ?)`,
      [
        runId,
        threadId,
        now,
        JSON.stringify({
          maxRunSteps: 20,
          maxActiveExecutionSeconds: 3_600,
          toolTimeoutSeconds: 120,
          maxToolOutputBytes: 1_048_576,
          maxRecallItems: 5,
          maxRecallBytes: 8_192,
          maxSubagentMessages: 100,
          maxSubagentMessageBytes: 1_048_576,
          contextPolicy: freezeRunContextPolicy('normal'),
          contextCompactionMode: 'balanced',
          revision: 1,
        }),
        JSON.stringify({
          schemaVersion: 1,
          agentDefinitionId: 'scenario-agent',
          requiredModelCapabilities: ['tools', 'image_input', 'reasoning'],
          model: primaryRef,
          modelCapabilities: primaryCapabilities,
          rootModelRoutes: [frozenFallbackRoute],
          reasoningEffort: 'medium',
          approvalMode: 'ask',
          executionMode: 'execute',
          connectionIds: [],
          environment: null,
          policyRevision: 1,
          settingsRevision: 1,
        }),
        JSON.stringify({ schemaVersion: 1, revision: 0, items: [] }),
        JSON.stringify({
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
          steps: 0,
          subagentMessages: 0,
          subagentMessageBytes: 0,
        }),
        now,
        now,
        now,
      ],
    );
    await db.execute(
      `INSERT INTO ai_thread_entries
        (id, thread_id, user_id, app_id, run_id, sequence, kind, payload_json, created_at)
       VALUES ('provider-fallback-input', ?, 1, 'scenario-app', ?, 1, 'user_input', ?, ?)`,
      [
        threadId,
        runId,
        JSON.stringify({ text: 'Use the configured fallback if the primary is unavailable.', artifactRefs: [] }),
        now,
      ],
    );
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES (?, ?, 'root', 'native', ?, 'running', 'runnable', 0, 'owner-provider-fallback', ?, ?)`,
      [runtimeId, runId, JSON.stringify(primaryRef), now, now],
    );

    const conversations = new ConversationService(conversationRepository, clock, null!, null!);
    const context = new ContextService(
      conversations,
      new RecallService(new EmptyRecallRepository(), clock),
      new SkillRegistry(),
      emptyModelContinuations,
      null!,
    );
    const scriptedModel = new ScriptedLanguageModel([
      {
        events: [{ type: 'usage', usage: { inputTokens: 20, outputTokens: 1, cachedInputTokens: 0 } }],
        error: new Error('PROVIDER_HTTP_503'),
        assertRequest: (request) => assert.equal(request.providerId, primaryRef.providerId),
      },
      {
        events: [{ type: 'usage', usage: { inputTokens: 21, outputTokens: 1, cachedInputTokens: 0 } }],
        error: new Error('PROVIDER_HEADERS_TIMEOUT'),
        assertRequest: (request) => assert.equal(request.providerId, primaryRef.providerId),
      },
      {
        events: [
          { type: 'message.delta', text: 'stale-' },
          { type: 'tool.delta', index: 0, id: 'stale-tool', name: 'scenario_read', argumentsDelta: '{}' },
          { type: 'usage', usage: { inputTokens: 22, outputTokens: 2, cachedInputTokens: 0 } },
        ],
        error: new Error('PROVIDER_UNAVAILABLE'),
        assertRequest: (request) => assert.equal(request.providerId, primaryRef.providerId),
      },
      {
        events: [
          { type: 'message.delta', text: 'fallback-ok' },
          { type: 'usage', usage: { inputTokens: 18, outputTokens: 3, cachedInputTokens: 2 } },
          { type: 'completed', finishReason: 'stop' },
        ],
        assertRequest: (request) => {
          assert.equal(request.providerId, fallbackRef.providerId);
          assert.equal(request.modelId, fallbackRef.modelId);
          assert.equal(request.configurationVersion, fallbackRef.configurationVersion);
          assert.equal(request.capabilitySnapshot?.contextWindow, fallbackCapabilities.contextWindow);
        },
      },
    ]);
    const providers = new ProviderService(
      new StaticProviderCatalogRepository([primaryPersisted, fallbackPersisted]),
      scriptedModel,
      clock,
    );
    const modelRunner = new ModelStepRunner(providers, context, scriptedModel, new ScenarioModelCallLimiter());
    const snapshot = await repository.snapshot(scope, runId);
    assert.ok(snapshot, 'fallback fixture run must exist');
    assert.equal(
      snapshot.definition.rootModelRoutes?.length,
      1,
      'frozen fallback routes must survive durable definition decode',
    );
    assert.equal(
      snapshot.definition.rootModelRoutes?.[0]?.modelCapabilities?.contextWindow,
      fallbackCapabilities.contextWindow,
    );
    assert.deepEqual(
      runModelRoutes(snapshot.definition).map((route) => route.model),
      [primaryRef, fallbackRef],
      'effective frozen route chain must contain primary exactly once followed by configured fallbacks',
    );

    modelRunner.waitBeforeRetry = async () => undefined;
    const signal = new AbortController().signal;
    const recoverySafePoints: string[] = [];
    const backend = new NativeAgentBackend(
      repository,
      { listDelegations: async () => [] } as never,
      stateCommit,
      modelRunner,
      { schemas: () => [] } as unknown as ToolCallRunner,
      clock,
      async (_run, reason) => {
        recoverySafePoints.push(reason);
      },
    );
    const backendSignals: BackendSignal[] = [];
    for await (const backendSignal of backend.execute(snapshot, signal)) backendSignals.push(backendSignal);
    assert.deepEqual(
      recoverySafePoints,
      ['model_boundary'],
      'Native Root execution must await the rolling recovery checkpoint hook before a new model step',
    );

    const finalSnapshot = await repository.snapshot(scope, runId);
    assert.ok(finalSnapshot);
    assert.equal(finalSnapshot.status, 'completed_unverified');
    const durableRoute = await repository.rootRuntimeModel(scope, runId);
    assert.deepEqual(durableRoute, fallbackRef, 'runtime model_ref_json must be the restart-safe current route');

    const transientMessages = backendSignals.filter(
      (item): item is Extract<BackendSignal, { type: 'transient'; eventType: 'message.delta' }> =>
        item.type === 'transient' && item.eventType === 'message.delta',
    );
    const staleMessage = transientMessages.find((item) => item.payload.text === 'stale-');
    const fallbackMessage = transientMessages.find((item) => item.payload.text === 'fallback-ok');
    assert.ok(staleMessage && fallbackMessage);
    assert.notEqual(staleMessage.payload.attemptId, fallbackMessage.payload.attemptId);
    assert.notEqual(staleMessage.payload.attemptIndex, fallbackMessage.payload.attemptIndex);

    const routeEvents = await db.queryAll<{ payload_json: string }>(
      `SELECT payload_json FROM agent_events WHERE run_id = ? AND type = 'model.route_changed' ORDER BY sequence`,
      [runId],
    );
    assert.equal(routeEvents.length, 1, 'production execution must emit exactly one durable route change');
    const routePayload = JSON.parse(routeEvents[0]!.payload_json) as Record<string, unknown>;
    assert.deepEqual(routePayload.from, primaryRef);
    assert.deepEqual(routePayload.to, fallbackRef);
    assert.equal(routePayload.routeIndex, 1);
    assert.equal(routePayload.errorCode, 'PROVIDER_UNAVAILABLE');

    const attempts = await db.queryAll<{
      attempt_index: number;
      status: string;
      input_tokens: number | null;
      output_tokens: number | null;
      error_code: string | null;
    }>(
      `SELECT a.attempt_index, a.status, a.input_tokens, a.output_tokens, a.error_code
       FROM agent_model_attempts a
       JOIN agent_steps s ON s.id = a.step_id
       WHERE s.run_id = ? ORDER BY a.attempt_index`,
      [runId],
    );
    assert.deepEqual(
      attempts.map((attempt) => [attempt.attempt_index, attempt.status, attempt.input_tokens, attempt.output_tokens]),
      [
        [1, 'failed', 20, 1],
        [2, 'failed', 21, 1],
        [3, 'failed', 22, 2],
        [4, 'completed', 18, 3],
      ],
      'each route attempt must retain independent durable usage',
    );

    const fallbackRequest = scriptedModel.requests.at(-1)!;
    const primaryContinuation: ModelProviderContinuation = {
      schemaVersion: 1,
      providerId: primaryRef.providerId,
      modelId: primaryRef.modelId,
      configurationVersion: primaryRef.configurationVersion,
      protocol: 'responses',
      format: 'openai.responses.stateless.v1',
      data: { parts: [] },
    };
    assert.deepEqual(
      decodeOpenAiResponsesContinuation(primaryContinuation, fallbackRequest, 'responses'),
      [],
      'opaque provider continuation must fail closed across a route change',
    );
    scriptedModel.assertConsumed();

    return [
      { name: 'same_route_failed_attempts_before_fallback', value: 3, unit: 'attempts' },
      { name: 'durable_route_changes', value: 1, unit: 'events' },
      { name: 'authoritative_attempts', value: attempts.length, unit: 'attempts' },
      { name: 'fallback_route_index', value: 1, unit: 'index' },
      { name: 'cross_route_continuations_reused', value: 0, unit: 'continuations' },
      { name: 'native_recovery_model_safe_points', value: recoverySafePoints.length, unit: 'checkpoints' },
    ];
  } finally {
    await db.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

const readToolBatchAuthorityScenario: Scenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-read-batch-scenario-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'read-batch.sqlite', nodeEnv: 'test' });
  const stateCommit = new SqliteStateCommitAdapter(db);
  const now = 1_800_200_000;
  const budget = JSON.stringify({
    maxRunSteps: 100,
    maxActiveExecutionSeconds: 3_600,
    toolTimeoutSeconds: 120,
    maxToolOutputBytes: 1_048_576,
    maxRecallItems: 5,
    maxRecallBytes: 8_192,
    maxSubagentMessages: 100,
    maxSubagentMessageBytes: 1_048_576,
    contextPolicy: freezeRunContextPolicy('normal'),
    contextCompactionMode: 'balanced',
    revision: 1,
  });
  const definition = JSON.stringify({
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
  });
  const plan = JSON.stringify({ schemaVersion: 1, revision: 0, items: [] });
  const usage = JSON.stringify({
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    steps: 0,
    subagentMessages: 0,
    subagentMessageBytes: 0,
  });
  const modelRef = JSON.stringify({
    providerId: 'scenario-provider',
    modelId: 'scenario-model',
    configurationVersion: 1,
  });
  const result = (summary: string) => ({
    ok: true,
    summary,
    data: { summary },
    artifactRefs: [],
    truncated: false,
    outcome: 'confirmed' as const,
    verification: { status: 'verified' as const, summary: 'scenario verified', evidenceRefs: [] },
  });

  const insertTool = async (
    stepIndex: number,
    suffix: string,
    sourceModelStepId: string,
    batchIndex: number,
    batchSize: number,
  ): Promise<{ toolStepId: string; toolCallId: string }> => {
    const toolStepId = `read-batch-step-${suffix}`;
    const toolCallId = `read-batch-tool-${suffix}`;
    await db.execute(
      `INSERT INTO agent_steps
        (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
         input_refs_json, output_refs_json, created_at)
       VALUES (?, 'read-batch-run', 'read-batch-runtime', ?, 'tool', 'created', 0, '[]', '[]', ?)`,
      [toolStepId, stepIndex, now],
    );
    await db.execute(
      `INSERT INTO agent_tool_calls
        (id, run_id, agent_runtime_id, step_id, source_model_step_id, batch_index, batch_size,
         provider_call_id, tool_name, tool_version,
         inspection_json, operation_hash, operation_hash_version, risk, status, created_at)
       VALUES (?, 'read-batch-run', 'read-batch-runtime', ?, ?, ?, ?, ?, 'file_read', '1', '{}', ?, 1,
               'read', 'proposed', ?)`,
      [toolCallId, toolStepId, sourceModelStepId, batchIndex, batchSize, `provider-${suffix}`, `hash-${suffix}`, now],
    );
    return { toolStepId, toolCallId };
  };

  try {
    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'read-batch-user', 'not-used')");
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
       VALUES (1, 'read-batch-app', '1.0.0', 'enabled', 'running', 1, ?, ?)`,
      [now, now],
    );
    await db.execute(
      `INSERT INTO ai_threads (id, user_id, app_id, title, title_source, created_at, updated_at)
       VALUES ('read-batch-thread', 1, 'read-batch-app', 'read batch', 'manual', ?, ?)`,
      [now, now],
    );
    await db.execute(
      `INSERT INTO agent_runs
        (id, user_id, app_id, thread_id, status, goal_status, verification_status,
         budget_json, definition_json, plan_json, usage_json, executing_runtime_count,
         created_at, started_at, updated_at)
       VALUES ('read-batch-run', 1, 'read-batch-app', 'read-batch-thread', 'running', 'in_progress', 'not_started',
               ?, ?, ?, ?, 1, ?, ?, ?)`,
      [budget, definition, plan, usage, now, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES ('read-batch-runtime', 'read-batch-run', 'root', 'native', ?, 'running', 'executing', 0,
               'owner-read-batch-runtime', ?, ?)`,
      [modelRef, now, now],
    );

    await db.execute(
      `INSERT INTO agent_steps
        (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
         input_refs_json, output_refs_json, created_at, completed_at)
       VALUES ('read-batch-model-single', 'read-batch-run', 'read-batch-runtime', 1,
               'model', 'completed', 0, '[]', '[]', ?, ?)`,
      [now, now],
    );
    const single = await insertTool(2, 'single', 'read-batch-model-single', 0, 1);
    const singleBegun = await stateCommit.beginReadToolBatch({
      scope: { userId: 1, appId: 'read-batch-app' },
      runId: 'read-batch-run',
      runtimeId: 'read-batch-runtime',
      expectedRunVersion: 1,
      items: [single],
      now: now + 1,
    });
    assert.equal(singleBegun.run.version, 2);
    assert.equal(
      (await db.queryOne<{ status: string }>("SELECT status FROM agent_tool_calls WHERE id = 'read-batch-tool-single'"))
        ?.status,
      'running',
    );
    const singleSettled = await stateCommit.settleReadToolBatch({
      scope: { userId: 1, appId: 'read-batch-app' },
      runId: 'read-batch-run',
      runtimeId: 'read-batch-runtime',
      expectedRunVersion: 2,
      items: [
        {
          ...single,
          toolResultEntryId: 'read-batch-entry-single',
          providerCallId: 'provider-single',
          result: result('single result'),
        },
      ],
      now: now + 2,
    });
    assert.equal(singleSettled.run.version, 3);
    assert.equal(singleSettled.run.usage.steps, 1);

    await db.execute(
      `INSERT INTO agent_steps
        (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
         input_refs_json, output_refs_json, created_at, completed_at)
       VALUES ('read-batch-model-parallel', 'read-batch-run', 'read-batch-runtime', 3,
               'model', 'completed', 0, '[]', '[]', ?, ?)`,
      [now + 3, now + 3],
    );
    const first = await insertTool(4, 'parallel-a', 'read-batch-model-parallel', 0, 2);
    const second = await insertTool(5, 'parallel-b', 'read-batch-model-parallel', 1, 2);
    const parallelBegun = await stateCommit.beginReadToolBatch({
      scope: { userId: 1, appId: 'read-batch-app' },
      runId: 'read-batch-run',
      runtimeId: 'read-batch-runtime',
      expectedRunVersion: 3,
      items: [first, second],
      now: now + 3,
    });
    assert.equal(parallelBegun.run.version, 4);
    const parallelSettled = await stateCommit.settleReadToolBatch({
      scope: { userId: 1, appId: 'read-batch-app' },
      runId: 'read-batch-run',
      runtimeId: 'read-batch-runtime',
      expectedRunVersion: 4,
      items: [
        {
          ...first,
          toolResultEntryId: 'read-batch-entry-parallel-a',
          providerCallId: 'provider-parallel-a',
          result: result('parallel result A'),
        },
        {
          ...second,
          toolResultEntryId: 'read-batch-entry-parallel-b',
          providerCallId: 'provider-parallel-b',
          result: result('parallel result B'),
        },
      ],
      now: now + 4,
    });
    assert.equal(parallelSettled.run.version, 5);
    assert.equal(parallelSettled.run.usage.steps, 3);

    const toolRows = await db.queryAll<{ id: string; status: string }>(
      `SELECT id, status FROM agent_tool_calls WHERE run_id = 'read-batch-run' ORDER BY id`,
    );
    assert.equal(toolRows.length, 3);
    assert.ok(toolRows.every((row) => row.status === 'succeeded'));
    const ledgerRows = await db.queryAll<{ kind: string }>(
      `SELECT kind FROM ai_thread_entries WHERE run_id = 'read-batch-run' ORDER BY sequence`,
    );
    assert.equal(ledgerRows.length, 3);
    assert.ok(ledgerRows.every((row) => row.kind === 'tool_result'));

    return [
      { name: 'size_one_batches', value: 1, unit: 'batches' },
      { name: 'parallel_batches', value: 1, unit: 'batches' },
      { name: 'settled_read_tools', value: toolRows.length, unit: 'tools' },
    ];
  } finally {
    await db.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

const failFastSiblingCancellationScenario: Scenario = async () => {
  const now = 1_800_400_000;
  const scenarioScope: Scope = { userId: 1, appId: 'fail-fast-app' };
  const baseDelegation = (
    id: string,
    parentRuntimeId: string,
    childRuntimeId: string,
    status: DelegationView['status'],
    failureMode: DelegationView['failureMode'] = 'isolate',
  ): DelegationView => ({
    ...scenarioScope,
    id,
    runId: 'fail-fast-run',
    parentRuntimeId,
    childRuntimeId,
    profileId: 'default',
    grants: [],
    peerMessaging: 'parent-child',
    mutationMode: 'read-only',
    modelRef: { providerId: 'scenario-provider', modelId: 'scenario-model', configurationVersion: 1 },
    objective: id,
    constraints: [],
    inputArtifactRefs: [],
    completionCriteria: [],
    dependencyMode: 'settled',
    status,
    depth: parentRuntimeId === 'root-runtime' ? 1 : 2,
    failureMode,
    budget: { maxSteps: 10 },
    usage: { tokens: 0, steps: 0 },
    result: null,
    evidenceRefs: [],
    deadlineAt: now + 600,
    version: 1,
    createdAt: now,
    updatedAt: now,
    completedAt: status === 'failed' || status === 'cancelled' || status === 'completed' ? now : null,
  });
  const failed = baseDelegation('failed', 'root-runtime', 'failed-runtime', 'failed', 'failFast');
  const sibling = baseDelegation('sibling', 'root-runtime', 'sibling-runtime', 'running');
  const descendant = baseDelegation('descendant', 'sibling-runtime', 'descendant-runtime', 'running');
  const cancelledIds: string[] = [];
  const abortedRuntimeIds: string[] = [];
  const delegations = {
    listDelegations: async () => [failed, sibling],
    descendants: async (_scope: Scope, _runId: string, runtimeId: string) =>
      runtimeId === sibling.childRuntimeId ? [descendant] : [],
    cancelDelegation: async (
      _scope: Scope,
      _runId: string,
      delegationId: string,
      _expectedVersion: number,
      _now: number,
    ) => {
      cancelledIds.push(delegationId);
      const current = delegationId === sibling.id ? sibling : descendant;
      return { ...current, status: 'cancelled' as const, version: current.version + 1, completedAt: now };
    },
  };
  const completion = new SubagentCompletionCoordinator(
    null!,
    delegations as never,
    null!,
    null!,
    { send: async () => undefined } as never,
    null!,
    {
      enqueueRootRun: async () => undefined,
      wakeChildScheduler: () => undefined,
      cancelChildRuntime: (_runId, runtimeId) => abortedRuntimeIds.push(runtimeId),
    },
    { nowUnixSeconds: () => now } as ClockPort,
  );
  await completion.completeModelEarlyFailure(
    scenarioScope,
    { runId: failed.runId } as SchedulerWorkView,
    failed,
    'SCENARIO_FAILURE',
  );

  assert.deepEqual(cancelledIds, [descendant.id, sibling.id]);
  assert.deepEqual(abortedRuntimeIds, [descendant.childRuntimeId, sibling.childRuntimeId]);
  const failFastCancellationCount = cancelledIds.length;
  const failFastAbortCount = abortedRuntimeIds.length;
  cancelledIds.length = 0;
  abortedRuntimeIds.length = 0;
  await completion.completeToolDeadline(
    scenarioScope,
    { runId: failed.runId } as SchedulerWorkView,
    failed,
    'DELEGATION_DEADLINE_EXCEEDED',
  );
  assert.deepEqual(
    cancelledIds,
    [],
    'tool_step deadline completion must preserve the existing non-fail-fast cancellation behavior',
  );
  assert.deepEqual(abortedRuntimeIds, []);
  return [
    { name: 'fail_fast_cancelled_delegations', value: failFastCancellationCount, unit: 'delegations' },
    { name: 'fail_fast_runtime_aborts', value: failFastAbortCount, unit: 'runtimes' },
    { name: 'tool_deadline_fail_fast_cancellations', value: cancelledIds.length, unit: 'delegations' },
  ];
};

const subagentProfileStrategyScenario: Scenario = async () => {
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

const mutationOutputProjectionScenario: Scenario = async () => {
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

const artifactCrashReconciliationScenario: Scenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-artifact-reconcile-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'artifact-reconcile.sqlite', nodeEnv: 'test' });
  const limits: ArtifactLimitPolicyPort = {
    forUser: async () => ({
      maxSingleArtifactBytes: 1024 * 1024,
      maxGlobalArtifactBytes: 8 * 1024 * 1024,
      unretainedArtifactTtlSeconds: 60 * 60,
      minFreeDiskBytes: 0,
    }),
  };
  const store = new LocalArtifactStore(db, limits, { dataDirectory: directory, uploadTtlSeconds: 60 });
  const now = Math.floor(Date.now() / 1000);
  const appId = 'artifact-reconcile-app';
  const objectRoot = path.join(directory, 'agent', 'artifacts', 'objects');
  const tmpRoot = path.join(directory, 'agent', 'artifacts', 'tmp');
  const quotaScope = 'artifact:user:1';
  const payload = Buffer.from('artifact-crash-window-payload'.repeat(8), 'utf8');
  const payloadHash = createHash('sha256').update(payload).digest('hex');

  const insertArtifact = async (input: {
    id: string;
    storageKey: string;
    status: 'staging' | 'deleting';
    reservedBytes: number;
    sizeBytes: number;
    expiresAt: number | null;
    sha256?: string | null;
  }): Promise<void> => {
    await db.execute(
      `INSERT INTO ai_artifacts
        (id, user_id, app_id, original_name, media_type, storage_key, sha256,
         size_bytes, reserved_bytes, status, retained, version, created_at, ready_at, expires_at, deleted_at)
       VALUES (?, 1, ?, ?, 'application/octet-stream', ?, ?, ?, ?, ?, 0, 1, ?, ?, ?, NULL)`,
      [
        input.id,
        appId,
        `${input.id}.bin`,
        input.storageKey,
        input.sha256 ?? null,
        input.sizeBytes,
        input.reservedBytes,
        input.status,
        now - 30,
        input.status === 'deleting' ? now - 20 : null,
        input.expiresAt,
      ],
    );
  };

  try {
    await db.initialize();
    await db.execute(
      "INSERT INTO users (id, username, hashed_password) VALUES (1, 'artifact-reconcile-user', 'not-used')",
    );
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, created_at, updated_at)
       VALUES (1, ?, '1.0.0', 'enabled', 'running', ?, ?)`,
      [appId, now, now],
    );
    await db.execute(
      `INSERT INTO agent_quota_usage (scope_key, limit_bytes, used_bytes, reserved_bytes)
       VALUES (?, ?, 0, 0)`,
      [quotaScope, 8 * 1024 * 1024],
    );
    fs.mkdirSync(objectRoot, { recursive: true });
    fs.mkdirSync(tmpRoot, { recursive: true });

    // Crash window 1: rename(tmp -> object) completed, ready DB transaction never committed.
    const renamedKey = 'aa-renamed-before-ready';
    await insertArtifact({
      id: 'artifact-renamed-before-ready',
      storageKey: renamedKey,
      status: 'staging',
      reservedBytes: payload.length,
      sizeBytes: 0,
      expiresAt: now + 60,
    });
    await db.execute('UPDATE agent_quota_usage SET reserved_bytes = reserved_bytes + ? WHERE scope_key = ?', [
      payload.length,
      quotaScope,
    ]);
    fs.mkdirSync(path.join(objectRoot, renamedKey.slice(0, 2)), { recursive: true });
    fs.writeFileSync(path.join(objectRoot, renamedKey.slice(0, 2), renamedKey), payload);

    // Abandoned staging before rename: expiry must release reservation and delete the partial tmp file.
    const expiredKey = 'bb-expired-staging';
    await insertArtifact({
      id: 'artifact-expired-staging',
      storageKey: expiredKey,
      status: 'staging',
      reservedBytes: payload.length,
      sizeBytes: 0,
      expiresAt: now - 1,
    });
    await db.execute('UPDATE agent_quota_usage SET reserved_bytes = reserved_bytes + ? WHERE scope_key = ?', [
      payload.length,
      quotaScope,
    ]);
    fs.writeFileSync(path.join(tmpRoot, `${expiredKey}.part`), payload.subarray(0, 16));

    // Crash window 2: deleting was durable, object removal never happened.
    const deletingFileKey = 'cc-deleting-file-present';
    await insertArtifact({
      id: 'artifact-deleting-file-present',
      storageKey: deletingFileKey,
      status: 'deleting',
      reservedBytes: 0,
      sizeBytes: payload.length,
      expiresAt: null,
      sha256: payloadHash,
    });
    await db.execute('UPDATE agent_quota_usage SET used_bytes = used_bytes + ? WHERE scope_key = ?', [
      payload.length,
      quotaScope,
    ]);
    fs.mkdirSync(path.join(objectRoot, deletingFileKey.slice(0, 2)), { recursive: true });
    fs.writeFileSync(path.join(objectRoot, deletingFileKey.slice(0, 2), deletingFileKey), payload);

    // Crash window 3: object removal completed, deleted DB/quota transaction never committed.
    const deletingGoneKey = 'dd-deleting-file-gone';
    await insertArtifact({
      id: 'artifact-deleting-file-gone',
      storageKey: deletingGoneKey,
      status: 'deleting',
      reservedBytes: 0,
      sizeBytes: payload.length,
      expiresAt: null,
      sha256: payloadHash,
    });
    await db.execute('UPDATE agent_quota_usage SET used_bytes = used_bytes + ? WHERE scope_key = ?', [
      payload.length,
      quotaScope,
    ]);

    const repaired = await store.reconcile(32);
    assert.equal(repaired, 4);

    const renamed = await db.queryOne<{
      status: string;
      sha256: string | null;
      size_bytes: number;
      reserved_bytes: number;
    }>('SELECT status, sha256, size_bytes, reserved_bytes FROM ai_artifacts WHERE id = ?', [
      'artifact-renamed-before-ready',
    ]);
    assert.deepEqual(renamed, {
      status: 'ready',
      sha256: payloadHash,
      size_bytes: payload.length,
      reserved_bytes: 0,
    });
    assert.equal(
      (
        await db.queryOne<{ status: string }>('SELECT status FROM ai_artifacts WHERE id = ?', [
          'artifact-expired-staging',
        ])
      )?.status,
      'deleted',
    );
    assert.equal(fs.existsSync(path.join(tmpRoot, `${expiredKey}.part`)), false);
    for (const [id, storageKey] of [
      ['artifact-deleting-file-present', deletingFileKey],
      ['artifact-deleting-file-gone', deletingGoneKey],
    ] as const) {
      assert.equal(
        (await db.queryOne<{ status: string }>('SELECT status FROM ai_artifacts WHERE id = ?', [id]))?.status,
        'deleted',
      );
      assert.equal(fs.existsSync(path.join(objectRoot, storageKey.slice(0, 2), storageKey)), false);
    }
    const quota = await db.queryOne<{ used_bytes: number; reserved_bytes: number }>(
      'SELECT used_bytes, reserved_bytes FROM agent_quota_usage WHERE scope_key = ?',
      [quotaScope],
    );
    assert.deepEqual(quota, { used_bytes: payload.length, reserved_bytes: 0 });

    // A second pass must be a pure no-op: no duplicate quota transfer or decrement.
    assert.equal(await store.reconcile(32), 0);
    assert.deepEqual(
      await db.queryOne<{ used_bytes: number; reserved_bytes: number }>(
        'SELECT used_bytes, reserved_bytes FROM agent_quota_usage WHERE scope_key = ?',
        [quotaScope],
      ),
      quota,
    );

    return [
      { name: 'artifact_crash_windows_repaired', value: 3, unit: 'windows' },
      { name: 'expired_staging_repaired', value: 1, unit: 'artifacts' },
      { name: 'idempotent_second_pass_repairs', value: 0, unit: 'artifacts' },
    ];
  } finally {
    await db.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

const integrationCasBeforeRuntimeScenario: Scenario = async () => {
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

const integrationRefreshGenerationScenario: Scenario = async () => {
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

const acpInnerPermissionScenario: Scenario = async () => {
  const scope: Scope = { userId: 1, appId: 'acp-inner-permission-app' };
  const runId = 'acp-inner-permission-run';
  const runtimeId = 'acp-inner-permission-runtime';
  const integrationId = '00000000-0000-4000-8000-000000000108';
  const workspaceId = 'acp-inner-permission-workspace';
  const integration: IntegrationView = {
    ...scope,
    id: integrationId,
    kind: 'acp',
    configuration: {
      displayName: 'scenario-acp',
      transport: 'workspace-profile',
      profileId: 'scenario-acp-profile',
      protocolVersion: '1',
    },
    hasCredential: false,
    credentialRevision: 1,
    schemaHash: null,
    enabled: true,
    version: 1,
    createdAt: 1_801_100_000,
    updatedAt: 1_801_100_000,
  };
  const integrations = {
    get: async () => integration,
  } as unknown as IntegrationRepositoryPort;
  const workspaces = {
    getWorkspace: async () =>
      ({
        id: workspaceId,
        ...scope,
        runId,
        agentRuntimeId: runtimeId,
        generation: 1,
        version: 1,
        status: 'running',
        profile: {
          acpProfiles: [
            {
              id: 'scenario-acp-profile',
              profileRevision: 1,
              argv: ['scenario-acp'],
              cwd: '/workspace/work',
            },
          ],
        },
      }) as never,
  } as unknown as AgentWorkspaceRepositoryPort;
  const decisions: Array<'allow_once' | 'reject_once'> = [];
  let permissionRequests = 0;
  const runtime: AcpRuntimePort = {
    execute: async (_integration, _request, context) => {
      decisions.push(
        await context.requestPermission({
          sessionId: 'session-108',
          toolCallId: 'inner-tool-108',
          title: 'Write generated source',
          kind: 'edit',
          rawInput: { path: '/workspace/work/generated.ts', bytes: 128 },
        }),
      );
      return { text: 'permission scenario complete', stopReason: 'end_turn' };
    },
  };
  const tool = createAcpExecuteTool(
    integrations,
    workspaces,
    runtime,
    { sha256Utf8: (value) => createHash('sha256').update(value, 'utf8').digest('hex') },
    {
      request: async (toolContext, parentInspection, request) => {
        permissionRequests += 1;
        assert.equal(toolContext.toolCallId, 'outer-tool-108');
        assert.equal(parentInspection.operationHash, 'scenario-outer-operation-hash');
        assert.equal(request.sessionId, 'session-108');
        assert.equal(request.toolCallId, 'inner-tool-108');
        return 'allow_once';
      },
    },
  );
  const inspection: ToolInspection = {
    toolName: 'acp_execute',
    toolVersion: '1.0.0',
    normalizedArguments: {
      integrationId,
      integrationVersion: 1,
      workspaceId,
      generation: 1,
      profileId: 'scenario-acp-profile',
      profileRevision: 1,
      prompt: 'implement the requested change',
      cwd: '/workspace/work',
    },
    target: {
      kind: 'integration',
      integrationId,
      workspaceId,
      generation: 1,
      targetIdentity: `acp:${integrationId}:${workspaceId}:1:scenario-acp-profile`,
      endpoint: `workspace-acp:${workspaceId}:scenario-acp-profile`,
      loginUser: 'runner:acp',
      configurationHash: 'scenario-acp-configuration',
    },
    resourceKeys: [`integration:acp:${integrationId}`, `workspace:${workspaceId}:1`],
    risk: 'mutate',
    mutation: true,
    operationHash: 'scenario-outer-operation-hash',
    operationHashVersion: 1,
    preconditions: [],
    policyRevision: 1,
    inputRevision: 1,
  };
  const abort = new AbortController();
  const context: ToolContext = {
    ...scope,
    actor: { kind: 'agent', userId: 1, appId: scope.appId, runId, agentRuntimeId: runtimeId },
    runId,
    agentRuntimeId: runtimeId,
    toolCallId: 'outer-tool-108',
    connectionIds: [],
    environment: null,
    stepId: 'acp-inner-permission-step',
    signal: abort.signal,
    deadlineAt: 1_801_100_600,
    maxOutputBytes: 64 * 1024,
    inputRevision: 1,
  };

  await tool.execute(inspection, context);
  assert.deepEqual(
    decisions,
    ['allow_once'],
    'an explicit user-approved ACP inner action must resume the original ACP permission request',
  );

  return [
    { name: 'acp_inner_permission_requests', value: decisions.length, unit: 'requests' },
    { name: 'acp_inner_permission_broker_requests', value: permissionRequests, unit: 'requests' },
    {
      name: 'acp_inner_permission_allow_once',
      value: decisions.filter((decision) => decision === 'allow_once').length,
      unit: 'decisions',
    },
  ];
};

const acpInnerPermissionAbortRaceScenario: Scenario = async () => {
  const scope: Scope = { userId: 1, appId: 'acp-inner-permission-abort-app' };
  const runId = 'acp-inner-permission-abort-run';
  const runtimeId = 'acp-inner-permission-abort-runtime';
  const parentToolCallId = 'acp-inner-permission-abort-parent-tool';
  const now = 1_801_110_000;
  let approvalId = '';
  let notifyReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    notifyReady = resolve;
  });
  const closed: Array<'expired' | 'superseded'> = [];
  const broker = new AcpPermissionBroker(
    {
      requestAcpPermissionApproval: async (command) => {
        approvalId = command.approvalId;
        return undefined as never;
      },
      closeAcpPermissionApproval: async (command) => {
        closed.push(command.status);
        return undefined as never;
      },
    },
    { sha256Utf8: (value) => createHash('sha256').update(value, 'utf8').digest('hex') },
    { nowUnixSeconds: () => now } as ClockPort,
    (_changedRunId, changedApprovalId) => {
      if (changedApprovalId === approvalId) notifyReady();
    },
  );
  const parentInspection: ToolInspection = {
    toolName: 'acp_execute',
    toolVersion: '1.0.0',
    normalizedArguments: {},
    target: {
      kind: 'integration',
      targetIdentity: 'acp:abort-race',
      endpoint: 'workspace-acp:abort-race',
      loginUser: 'runner:acp',
      configurationHash: 'acp-abort-race-config',
    },
    resourceKeys: ['integration:acp:abort-race'],
    risk: 'mutate',
    mutation: true,
    operationHash: 'acp-abort-race-parent-operation',
    operationHashVersion: 1,
    preconditions: [],
    policyRevision: 1,
    inputRevision: 1,
  };
  const abort = new AbortController();
  const context: ToolContext = {
    ...scope,
    actor: { kind: 'agent', userId: 1, appId: scope.appId, runId, agentRuntimeId: runtimeId },
    runId,
    agentRuntimeId: runtimeId,
    toolCallId: parentToolCallId,
    connectionIds: [],
    environment: null,
    stepId: 'acp-inner-permission-abort-step',
    signal: abort.signal,
    deadlineAt: now + 120,
    maxOutputBytes: 64 * 1024,
    inputRevision: 1,
  };

  const pending = broker.request(context, parentInspection, {
    sessionId: 'session-abort-108',
    toolCallId: 'inner-tool-abort-108',
    title: 'Write source',
    kind: 'edit',
    rawInput: { path: '/workspace/work/abort.ts' },
  });
  await ready;
  assert.ok(approvalId);
  const handle = broker.take(approvalId);
  assert.ok(handle, 'the live ACP permission waiter must be reservable exactly once');
  assert.equal(broker.take(approvalId), null, 'a second resolver must not reserve the same live waiter');

  abort.abort(new Error('SCENARIO_ACP_PERMISSION_ABORTED'));
  await assert.rejects(pending, /SCENARIO_ACP_PERMISSION_ABORTED/);
  handle.finish('allow_once');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(closed, ['superseded'], 'abort must durably close the nested approval');

  const failClosedAbort = new AbortController();
  const failClosedReady = new Promise<void>((resolve) => {
    notifyReady = resolve;
  });
  const failClosedPending = broker.request(
    {
      ...context,
      toolCallId: 'acp-inner-permission-fail-closed-parent-tool',
      signal: failClosedAbort.signal,
    },
    parentInspection,
    {
      sessionId: 'session-fail-closed-108',
      toolCallId: 'inner-tool-fail-closed-108',
      title: 'Write source after stale approval',
      kind: 'edit',
      rawInput: { path: '/workspace/work/fail-closed.ts' },
    },
  );
  await failClosedReady;
  const failClosedHandle = broker.take(approvalId);
  assert.ok(failClosedHandle, 'a live waiter must be reservable before a durable resolution attempt');
  await failClosedHandle.failClosed();
  assert.equal(await failClosedPending, 'reject_once', 'failed durable resolution must reject the live ACP action');
  assert.deepEqual(
    closed,
    ['superseded', 'superseded'],
    'failed durable resolution must also close the requested approval instead of leaving it visible until TTL',
  );

  return [
    { name: 'acp_reserved_waiter_abort_allows', value: 0, unit: 'decisions' },
    { name: 'acp_reserved_waiter_abort_closures', value: closed.length, unit: 'approvals' },
    { name: 'acp_failed_resolution_open_approvals', value: 0, unit: 'approvals' },
  ];
};

const acpInnerPermissionReplayScenario: Scenario = async () => {
  const scope: Scope = { userId: 1, appId: 'acp-inner-permission-replay-app' };
  const runId = 'acp-inner-permission-replay-run';
  const approvalId = 'acp-inner-permission-replay-approval';
  const operationHash = 'acp-inner-permission-replay-operation';
  const now = 1_801_115_000;
  let status: 'requested' | 'approved' = 'approved';
  let commitCalls = 0;
  let takeCalls = 0;
  let outerReschedules = 0;
  let liveHandleAvailable = false;
  let failClosedCalls = 0;
  let finishCalls = 0;
  const inspection: ToolInspection = {
    toolName: 'acp_inner_permission',
    toolVersion: '1.0.0',
    normalizedArguments: { parentToolCallId: 'parent-tool-replay' },
    target: {
      kind: 'integration',
      targetIdentity: 'acp:replay',
      endpoint: 'workspace-acp:replay',
      loginUser: 'runner:acp',
      configurationHash: 'acp-replay-config',
    },
    resourceKeys: ['integration:acp:replay'],
    risk: 'mutate',
    mutation: true,
    operationHash,
    operationHashVersion: 1,
    preconditions: [],
    policyRevision: 1,
    inputRevision: 1,
  };
  const approval = () =>
    ({
      id: approvalId,
      ...scope,
      runId,
      toolCallId: 'parent-tool-replay',
      requestedByRuntimeId: 'runtime-replay',
      operationHash,
      operationHashVersion: 1,
      kind: 'acp_permission',
      status,
      policyRevision: 1,
      inputRevision: 1,
      decidedByUserId: status === 'approved' ? 1 : null,
      decidedAt: status === 'approved' ? now : null,
      consumedAt: status === 'approved' ? now : null,
      requestedAt: now - 10,
      expiresAt: now + 120,
      version: status === 'approved' ? 2 : 1,
      inspection,
    }) as never;
  const runSnapshot = { id: runId, version: 7 } as never;
  const service = new ApprovalService(
    {
      get: async () => approval(),
      list: async () => [],
    },
    { snapshot: async () => runSnapshot },
    {
      resolveToolApproval: async (command) => {
        commitCalls += 1;
        if (command.idempotencyKey === '00000000-0000-4000-8000-000000000183') {
          throw new Error('APPROVAL_STALE');
        }
        assert.equal(command.idempotencyKey, '00000000-0000-4000-8000-000000000181');
        return {
          run: runSnapshot,
          eventCursor: 0,
          ledgerCursor: 0,
          committedEvents: [],
        };
      },
    },
    { nowUnixSeconds: () => now } as ClockPort,
    () => {
      outerReschedules += 1;
    },
    {
      take: () => {
        takeCalls += 1;
        if (!liveHandleAvailable) return null;
        return {
          finish: () => {
            finishCalls += 1;
          },
          failClosed: async () => {
            failClosedCalls += 1;
          },
        };
      },
    },
  );

  const replayed = await service.resolve(
    scope,
    approvalId,
    'approved',
    operationHash,
    1,
    1,
    '00000000-0000-4000-8000-000000000181',
  );
  assert.equal(replayed.status, 'approved');
  assert.equal(commitCalls, 1, 'a durable resolved ACP approval must reach StateCommit replay without a live waiter');
  assert.equal(takeCalls, 0, 'a resolved ACP approval must not try to reserve a vanished live waiter');
  assert.equal(outerReschedules, 0, 'ACP approval replay must never redispatch the outer Tool');

  status = 'requested';
  await assert.rejects(
    () => service.resolve(scope, approvalId, 'approved', operationHash, 1, 1, '00000000-0000-4000-8000-000000000182'),
    /APPROVAL_STALE/,
  );
  assert.equal(takeCalls, 1, 'a still-requested ACP approval must require the live waiter');
  assert.equal(commitCalls, 1, 'a missing live waiter must block any new durable ACP approval after restart');

  liveHandleAvailable = true;
  await assert.rejects(
    () => service.resolve(scope, approvalId, 'approved', operationHash, 1, 1, '00000000-0000-4000-8000-000000000183'),
    /APPROVAL_STALE/,
  );
  assert.equal(commitCalls, 2);
  assert.equal(failClosedCalls, 1, 'a failed durable resolution must invoke the live handle fail-closed cleanup');
  assert.equal(finishCalls, 0, 'a failed durable resolution must never resume the ACP action as allowed');

  return [
    { name: 'acp_resolved_idempotent_replays', value: 1, unit: 'approvals' },
    { name: 'acp_pending_without_live_waiter_commits', value: 0, unit: 'approvals' },
    { name: 'acp_failed_resolution_cleanup_calls', value: failClosedCalls, unit: 'closures' },
    { name: 'acp_replay_outer_reschedules', value: outerReschedules, unit: 'runs' },
  ];
};

const modelAwareContextBudgetScenario: Scenario = async () => {
  const normal = freezeRunContextPolicy('normal');
  const extended = freezeRunContextPolicy('extended');
  assert.deepEqual(normal, {
    profile: 'normal',
    effectiveWindowPercent: 92,
    softPressurePercent: 80,
    toolOutputFloorPercent: 25,
  });
  assert.deepEqual(extended, {
    profile: 'extended',
    effectiveWindowPercent: 96,
    softPressurePercent: 88,
    toolOutputFloorPercent: 40,
  });

  const normalWindow = resolveModelContextBudget(normal, 200_000, 8_000);
  const extendedWindow = resolveModelContextBudget(extended, 200_000, 8_000);
  assert.deepEqual(normalWindow, {
    physicalInputTokens: 192_000,
    effectiveInputTokens: 176_640,
    softPressureTokens: 141_312,
  });
  assert.deepEqual(extendedWindow, {
    physicalInputTokens: 192_000,
    effectiveInputTokens: 184_320,
    softPressureTokens: 162_201,
  });

  const budget: RunView['budget'] = {
    contextPolicy: normal,
    maxRunSteps: 80,
    maxActiveExecutionSeconds: 1_800,
    toolTimeoutSeconds: 60,
    maxToolOutputBytes: 65_536,
    maxRecallItems: 5,
    maxRecallBytes: 8_192,
    maxSubagentMessages: 1_000,
    maxSubagentMessageBytes: 2_097_152,
    contextCompactionMode: 'balanced',
    revision: 1,
  };
  const atHardPressure = pressureAdjustedToolOutputBytes(budget, {
    inputTokens: normalWindow.effectiveInputTokens,
    reservedOutputTokens: 8_000,
    contextWindowTokens: 200_000,
    source: 'provider',
    updatedAt: 2,
  });
  assert.equal(atHardPressure, 16_384);

  const earlyPressurePlan = await contextService(
    Array.from({ length: 8 }, (_, index) =>
      entry(index + 1, index % 2 === 0 ? 'user_input' : 'assistant_message', {
        text: 'history '.repeat(160),
      }),
    ),
  ).compose({
    scope,
    threadId: 'scenario-thread',
    runId: 'scenario-run',
    currentInput: 'Continue.',
    modelContextWindow: 8_192,
    maxContextTokens: 2_300,
    softContextTokens: 900,
    reservedOutputTokens: 512,
    maxRecallItems: 1,
    maxRecallBytes: 1_024,
    tools: [],
  });
  assert.equal(earlyPressurePlan.compacted, true);

  const currentInputMarker = 'CURRENT_INPUT_CHECKPOINT_DEDUP_MARKER';
  const currentInputText = `${currentInputMarker} Preserve this input exactly once.`;
  const dedupPlan = await contextService([
    entry(1, 'user_input', { text: currentInputText }),
    entry(2, 'assistant_message', { text: 'historical assistant context '.repeat(220) }),
    entry(3, 'assistant_message', { text: 'older working notes '.repeat(220) }),
  ]).compose({
    scope,
    threadId: 'scenario-thread',
    runId: 'scenario-run',
    currentInput: currentInputText,
    currentInputEntryId: 'entry-1',
    modelContextWindow: 4_096,
    maxContextTokens: 1_800,
    softContextTokens: 1_200,
    reservedOutputTokens: 128,
    maxRecallItems: 1,
    maxRecallBytes: 1_024,
    tools: [],
  });
  const currentInputOccurrences =
    dedupPlan.messages
      .map((message) => message.content)
      .join('\n')
      .split(currentInputMarker).length - 1;
  assert.equal(
    currentInputOccurrences,
    1,
    'current input must not reappear through a derived checkpoint when context pressure compacts history',
  );

  const latestToolCallId = 'current-turn-tool-call';
  const latestExchangePlan = await contextService([
    entry(1, 'user_input', { text: 'Preserve the latest causal Tool exchange.' }),
    entry(2, 'assistant_message', {
      text: '',
      toolCalls: [{ id: latestToolCallId, name: 'skill_read', argumentsJson: '{"id":"nexus.agent.developer"}' }],
    }),
    entry(3, 'tool_result', {
      toolCallId: latestToolCallId,
      text: 'latest tool result '.repeat(380),
    }),
  ]).compose({
    scope,
    threadId: 'scenario-thread',
    runId: 'scenario-run',
    currentInput: 'Preserve the latest causal Tool exchange.',
    currentInputEntryId: 'entry-1',
    modelContextWindow: 8_192,
    maxContextTokens: 7_000,
    softContextTokens: 900,
    reservedOutputTokens: 512,
    maxRecallItems: 1,
    maxRecallBytes: 1_024,
    tools: [],
  });
  assert.equal(latestExchangePlan.compacted, true, 'latest causal exchange regression must exercise compaction');
  assert.ok(
    latestExchangePlan.messages.some((message) => message.role === 'tool' && message.toolCallId === latestToolCallId),
    'soft-pressure selection must retain the newest complete Tool exchange before reserving summary/recall space',
  );

  return [
    { name: 'normal_effective_context_tokens', value: normalWindow.effectiveInputTokens, unit: 'tokens' },
    { name: 'extended_effective_context_tokens', value: extendedWindow.effectiveInputTokens, unit: 'tokens' },
    { name: 'pressure_tool_output_floor_bytes', value: atHardPressure, unit: 'bytes' },
    { name: 'soft_pressure_compactions', value: earlyPressurePlan.compacted ? 1 : 0, unit: 'plans' },
    { name: 'current_input_projection_occurrences', value: currentInputOccurrences, unit: 'messages' },
    {
      name: 'latest_causal_tool_exchange_retained',
      value: latestExchangePlan.messages.some((message) => message.role === 'tool') ? 1 : 0,
      unit: 'exchanges',
    },
  ];
};

const cumulativeTokenCeilingRemovedScenario: Scenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-token-ceiling-removed-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'token-ceiling.sqlite', nodeEnv: 'test' });
  const stateCommit = new SqliteStateCommitAdapter(db);
  const now = 1_801_100_000;
  const scenarioScope: Scope = { userId: 1, appId: 'token-ceiling-app' };
  const runId = 'token-ceiling-run';
  const rootRuntimeId = 'token-ceiling-root';
  const childRuntimeId = 'token-ceiling-child';
  const delegationId = 'token-ceiling-delegation';
  const modelRef = JSON.stringify({
    providerId: 'scenario-provider',
    modelId: 'scenario-model',
    configurationVersion: 1,
  });
  const budget = JSON.stringify({
    maxRunSteps: 100,
    maxActiveExecutionSeconds: 3_600,
    toolTimeoutSeconds: 120,
    maxToolOutputBytes: 1_048_576,
    maxRecallItems: 5,
    maxRecallBytes: 8_192,
    maxSubagentMessages: 100,
    maxSubagentMessageBytes: 1_048_576,
    contextPolicy: freezeRunContextPolicy('normal'),
    contextCompactionMode: 'balanced',
    revision: 1,
  });
  const definition = JSON.stringify({
    schemaVersion: 1,
    agentDefinitionId: 'scenario-agent',
    requiredModelCapabilities: [],
    model: JSON.parse(modelRef),
    modelCapabilities: SCENARIO_MODEL_CAPABILITIES,
    rootModelRoutes: [],
    approvalMode: 'ask',
    executionMode: 'execute',
    connectionIds: [],
    environment: null,
    policyRevision: 1,
    settingsRevision: 1,
  });
  const usage = JSON.stringify({
    inputTokens: 1_250_000,
    outputTokens: 350_000,
    cachedInputTokens: 700_000,
    steps: 4,
    subagentMessages: 0,
    subagentMessageBytes: 0,
  });

  try {
    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'token-ceiling-user', 'not-used')");
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
       VALUES (1, ?, '1.0.0', 'enabled', 'running', 1, ?, ?)`,
      [scenarioScope.appId, now, now],
    );
    await db.execute(
      `INSERT INTO ai_threads (id, user_id, app_id, title, title_source, created_at, updated_at)
       VALUES ('token-ceiling-thread', 1, ?, 'token ceiling removed', 'manual', ?, ?)`,
      [scenarioScope.appId, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runs
        (id, user_id, app_id, thread_id, status, goal_status, verification_status,
         budget_json, definition_json, plan_json, usage_json, executing_runtime_count,
         created_at, started_at, updated_at)
       VALUES (?, 1, ?, 'token-ceiling-thread', 'running', 'in_progress', 'not_started',
               ?, ?, '{"schemaVersion":1,"revision":0,"items":[]}', ?, 0, ?, ?, ?)`,
      [runId, scenarioScope.appId, budget, definition, usage, now, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES (?, ?, 'root', 'native', ?, 'running', 'runnable', 0, 'owner-token-root', ?, ?)`,
      [rootRuntimeId, runId, modelRef, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES (?, ?, 'child:token-ceiling-delegation', 'native', ?, 'running', 'runnable', 0,
               'owner-token-child', ?, ?)`,
      [childRuntimeId, runId, modelRef, now, now],
    );
    await db.execute(
      `INSERT INTO agent_delegations
        (id, run_id, parent_runtime_id, child_runtime_id, profile_id, grants_json, peer_messaging,
         model_ref_json, objective, constraints_json, input_artifact_refs_json, completion_criteria_json,
         dependency_mode, status, depth, failure_mode, max_steps, idempotency_key, request_hash,
         deadline_at, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'default', '[]', 'parent-child', ?, 'continue despite cumulative token telemetry',
               '[]', '[]', '[]', 'settled', 'running', 1, 'isolate', 10,
               'token-ceiling-delegation-key', 'token-ceiling-delegation-hash', ?, 1, ?, ?)`,
      [delegationId, runId, rootRuntimeId, childRuntimeId, scenarioDelegationModel(modelRef), now + 600, now, now],
    );
    await db.execute(
      `INSERT INTO agent_scheduler_work
        (id, run_id, agent_runtime_id, kind, status, payload_json, owner_epoch, not_before, deadline_at,
         created_at, updated_at)
       VALUES ('token-ceiling-child-work', ?, ?, 'model_step', 'claimed', '{}', 77, ?, ?, ?, ?)`,
      [runId, childRuntimeId, now, now + 600, now, now],
    );

    const rootStarted = await stateCommit.beginModelStep({
      scope: scenarioScope,
      runId,
      runtimeId: rootRuntimeId,
      expectedRunVersion: 1,
      inputWatermark: 0,
      reservedTokens: 12_000,
      estimatedInputTokens: 74_000,
      reservedOutputTokens: 8_000,
      contextWindowTokens: 200_000,
      now: now + 1,
    });
    assert.equal(rootStarted.run.status, 'running');
    assert.equal(rootStarted.run.usage.inputTokens, 1_250_000);
    assert.equal(rootStarted.run.usage.outputTokens, 350_000);
    assert.deepEqual(rootStarted.run.usage.context, {
      inputTokens: 74_000,
      heuristicInputTokens: 74_000,
      reservedOutputTokens: 8_000,
      contextWindowTokens: 200_000,
      source: 'estimated',
      updatedAt: now + 1,
    });

    const childStarted = await stateCommit.beginSubagentModelStep({
      scope: scenarioScope,
      runId,
      runtimeId: childRuntimeId,
      delegationId,
      workId: 'token-ceiling-child-work',
      ownerEpoch: 77,
      reservedTokens: 8_000,
      now: now + 2,
    });
    assert.equal(childStarted.run.status, 'running');
    assert.equal(childStarted.run.usage.inputTokens, 1_250_000);
    assert.equal(childStarted.run.usage.outputTokens, 350_000);

    const delegationColumns = await db.queryAll<{ name: string }>('PRAGMA table_info(agent_delegations)');
    const delegationColumnNames = new Set(delegationColumns.map((column) => column.name));
    for (const removed of ['max_tokens', 'reserved_tokens', 'reserved_steps']) {
      assert.equal(delegationColumnNames.has(removed), false, `${removed} must be removed from the current schema`);
    }

    assert.throws(
      () =>
        parseBudgetIncreaseRequest({
          schemaVersion: 1,
          scope: 'run',
          increase: { maxRunTokens: 2_000_000 },
          expectedVersion: childStarted.run.version,
        }),
      /VALIDATION_FAILED/,
    );

    return [
      { name: 'cumulative_tokens_before_next_step', value: 1_600_000, unit: 'tokens' },
      { name: 'root_steps_started_above_old_ceiling', value: 1, unit: 'steps' },
      { name: 'child_steps_started_above_old_ceiling', value: 1, unit: 'steps' },
      { name: 'removed_delegation_budget_columns', value: 3, unit: 'columns' },
    ];
  } finally {
    await db.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

const publicAgentErrorTaxonomyScenario: Scenario = async () => {
  const routeError = async (rawCode: string): Promise<{ status: number; code: string }> =>
    new Promise((resolve, reject) => {
      let status = 0;
      const response = {
        locals: {},
        headersSent: false,
        setHeader: () => response,
        status: (value: number) => {
          status = value;
          return response;
        },
        json: (body: unknown) => {
          try {
            const error = (body as { error?: { code?: unknown } }).error;
            assert.ok(error && typeof error.code === 'string');
            resolve({ status, code: error.code });
          } catch (error) {
            reject(error);
          }
          return response;
        },
      };
      const request = { header: () => undefined };
      agentRoute(async () => {
        throw new Error(rawCode);
      })(request as never, response as never, (() => undefined) as never);
    });

  const cases: Array<{ producer: string; raw: string; status: number; code: string }> = [
    {
      producer: 'capability grant scope validation',
      raw: 'APP_GRANT_SCOPE_INVALID',
      status: 400,
      code: 'VALIDATION_FAILED',
    },
    { producer: 'subagent missing run', raw: 'RUN_NOT_FOUND', status: 404, code: 'NOT_FOUND' },
    { producer: 'subagent terminal run', raw: 'RUN_NOT_ACTIVE', status: 409, code: 'RUN_NOT_ACTIVE' },
    {
      producer: 'subagent stale cancel',
      raw: 'DELEGATION_VERSION_CONFLICT',
      status: 409,
      code: 'DELEGATION_VERSION_CONFLICT',
    },
    {
      producer: 'workspace ACP selection',
      raw: 'ACP_PROFILE_SELECTION_INVALID',
      status: 400,
      code: 'ACP_PROFILE_SELECTION_INVALID',
    },
    { producer: 'workspace ACP missing', raw: 'ACP_PROFILE_NOT_FOUND', status: 404, code: 'NOT_FOUND' },
    {
      producer: 'provider explicit capability metadata',
      raw: 'PROVIDER_CAPABILITY_METADATA_INVALID',
      status: 502,
      code: 'PROVIDER_CAPABILITY_METADATA_INVALID',
    },
    { producer: 'workspace browser missing', raw: 'BROWSER_TARGET_NOT_FOUND', status: 404, code: 'NOT_FOUND' },
    {
      producer: 'workspace browser incompatible',
      raw: 'BROWSER_TARGET_REQUIRES_BROWSER_RECIPE',
      status: 422,
      code: 'BROWSER_TARGET_REQUIRES_BROWSER_RECIPE',
    },
    {
      producer: 'plugin storage CAS',
      raw: 'APP_STORAGE_VERSION_CONFLICT',
      status: 409,
      code: 'APP_STORAGE_VERSION_CONFLICT',
    },
    {
      producer: 'plugin storage payload',
      raw: 'APP_STORAGE_VALUE_TOO_LARGE',
      status: 413,
      code: 'APP_STORAGE_VALUE_TOO_LARGE',
    },
    {
      producer: 'plugin storage quota',
      raw: 'APP_STORAGE_QUOTA_EXCEEDED',
      status: 507,
      code: 'APP_STORAGE_QUOTA_EXCEEDED',
    },
    { producer: 'workspace artifact import', raw: 'ARTIFACT_NOT_READY', status: 409, code: 'ARTIFACT_NOT_READY' },
    {
      producer: 'per-Run artifact quota',
      raw: 'ARTIFACT_RUN_QUOTA_EXCEEDED',
      status: 507,
      code: 'ARTIFACT_QUOTA_EXCEEDED',
    },
    {
      producer: 'checkpoint model capability contract',
      raw: 'CHECKPOINT_MODEL_CAPABILITY_UNSUPPORTED',
      status: 422,
      code: 'CHECKPOINT_MODEL_CAPABILITY_UNSUPPORTED',
    },
    {
      producer: 'MCP endpoint syntax',
      raw: 'INTEGRATION_ENDPOINT_INVALID',
      status: 400,
      code: 'INTEGRATION_ENDPOINT_INVALID',
    },
    {
      producer: 'MCP private endpoint policy',
      raw: 'INTEGRATION_PRIVATE_ENDPOINT_DENIED',
      status: 422,
      code: 'INTEGRATION_PRIVATE_ENDPOINT_DENIED',
    },
    {
      producer: 'MCP DNS unavailable',
      raw: 'INTEGRATION_DNS_RESOLUTION_FAILED',
      status: 503,
      code: 'INTEGRATION_DNS_RESOLUTION_FAILED',
    },
  ];
  for (const expected of cases) {
    const actual = await routeError(expected.raw);
    assert.deepEqual(actual, { status: expected.status, code: expected.code }, expected.producer);
    assert.notEqual(actual.status, 500, `${expected.producer} must not degrade to INTERNAL_ERROR`);
  }

  const durableStateFaults = ['AGENT_DURABLE_STATE_INVALID', 'SUBAGENT_DURABLE_STATE_INVALID'] as const;
  for (const code of durableStateFaults) {
    assert.deepEqual(
      await routeError(code),
      { status: 500, code },
      `${code} must preserve a stable public diagnostic code while remaining a server fault`,
    );
  }
  assert.deepEqual(
    await routeError('UNMAPPED_INTERNAL_SECRET'),
    { status: 500, code: 'INTERNAL_ERROR' },
    'unknown internal errors must remain masked',
  );

  return [
    { name: 'public_error_contract_cases', value: cases.length, unit: 'cases' },
    { name: 'public_errors_degraded_to_500', value: 0, unit: 'cases' },
    { name: 'public_durable_state_fault_codes', value: durableStateFaults.length, unit: 'cases' },
    { name: 'masked_unknown_internal_errors', value: 1, unit: 'cases' },
    { name: 'public_error_status_classes', value: new Set(cases.map((item) => item.status)).size, unit: 'statuses' },
  ];
};

const durableBoundaryDecodeScenario: Scenario = async () => {
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

const currentDurableSchemaScenario: Scenario = async () => {
  const canonicalModels = JSON.stringify([
    {
      id: 'scenario-model',
      capabilityOverrides: {
        contextWindow: 32_768,
        maxOutputTokens: 4_096,
        supportsTools: true,
        reasoning: {
          supportedEfforts: ['low', 'medium', 'high'],
          defaultEffort: 'medium',
          mandatory: false,
        },
      },
    },
  ]);
  const decodedCanonicalModels = decodePersistedProviderModels(canonicalModels);
  assert.equal(decodedCanonicalModels[0]?.id, 'scenario-model');
  assert.throws(
    () =>
      decodePersistedProviderModels(
        JSON.stringify([
          {
            id: 'scenario-model',
            capabilityOverrides: {
              contextWindow: 32_768,
              maxOutputTokens: 4_096,
              supportsTools: true,
              reasoning: {
                supportedEfforts: ['low', 'medium', 'high'],
                defaultEffort: 'medium',
                mandatory: false,
                supportsMaxTokens: true,
              },
            },
          },
        ]),
      ),
    /AGENT_DURABLE_STATE_INVALID/,
    'removed reasoning metadata must fail closed instead of being normalized away',
  );
  assert.throws(
    () =>
      decodePersistedProviderModels(
        JSON.stringify([
          {
            id: 'scenario-model',
            contextWindow: 32_768,
            maxOutputTokens: 4_096,
            supportsTools: true,
          },
        ]),
      ),
    /AGENT_DURABLE_STATE_INVALID/,
    'unreleased flat provider capability schema must not remain as a runtime compatibility shim',
  );

  return [
    { name: 'provider_removed_runtime_shims', value: 0, unit: 'branches' },
    { name: 'provider_removed_shape_rejections', value: 2, unit: 'cases' },
  ];
};

const modelFinishReasonStateMachineScenario: Scenario = async () => {
  const cases = [
    { reason: 'stop' as const, toolCalls: 0, expected: { kind: 'complete' } },
    { reason: 'tool-calls' as const, toolCalls: 2, expected: { kind: 'tool_calls' } },
    { reason: 'length' as const, toolCalls: 0, expected: { kind: 'failed', errorCode: 'MODEL_OUTPUT_TRUNCATED' } },
    {
      reason: 'content-filter' as const,
      toolCalls: 0,
      expected: { kind: 'failed', errorCode: 'MODEL_CONTENT_FILTERED' },
    },
    {
      reason: 'error' as const,
      toolCalls: 0,
      expected: { kind: 'failed', errorCode: 'MODEL_PROVIDER_REPORTED_ERROR' },
    },
    {
      reason: 'other' as const,
      toolCalls: 0,
      expected: { kind: 'failed', errorCode: 'MODEL_FINISH_REASON_UNSUPPORTED' },
    },
    {
      reason: null,
      toolCalls: 0,
      expected: { kind: 'failed', errorCode: 'MODEL_FINISH_REASON_MISSING' },
    },
    {
      reason: 'stop' as const,
      toolCalls: 1,
      expected: { kind: 'failed', errorCode: 'MODEL_FINISH_REASON_MISMATCH' },
    },
    {
      reason: 'tool-calls' as const,
      toolCalls: 0,
      expected: { kind: 'failed', errorCode: 'MODEL_FINISH_REASON_MISMATCH' },
    },
  ];
  for (const item of cases) {
    assert.deepEqual(modelFinishDisposition(item.reason, item.toolCalls), item.expected);
  }

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-finish-reason-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'finish.sqlite', nodeEnv: 'test' });
  const stateCommit = new SqliteStateCommitAdapter(db);
  const repository = new SqliteRunRepository(db);
  const now = 1_800_000_000;
  const runUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    steps: 0,
    subagentMessages: 0,
    subagentMessageBytes: 0,
  };
  try {
    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'finish-user', 'not-used')");
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
       VALUES (1, 'scenario-app', '1.0.0', 'enabled', 'running', 1, ?, ?)`,
      [now, now],
    );
    await db.execute(
      `INSERT INTO ai_threads (id, user_id, app_id, title, title_source, created_at, updated_at)
       VALUES ('finish-thread', 1, 'scenario-app', 'finish-thread', 'manual', ?, ?)`,
      [now, now],
    );
    await db.execute(
      `INSERT INTO agent_runs
        (id, user_id, app_id, thread_id, status, goal_status, verification_status,
         budget_json, definition_json, plan_json, usage_json, executing_runtime_count,
         created_at, started_at, updated_at)
       VALUES ('finish-run', 1, 'scenario-app', 'finish-thread', 'running', 'in_progress', 'not_started',
               ?, ?, ?, ?, 1, ?, ?, ?)`,
      [
        JSON.stringify({
          maxRunSteps: 100,
          maxActiveExecutionSeconds: 3_600,
          toolTimeoutSeconds: 120,
          maxToolOutputBytes: 1_048_576,
          maxRecallItems: 5,
          maxRecallBytes: 8_192,
          maxSubagentMessages: 100,
          maxSubagentMessageBytes: 1_048_576,
          contextPolicy: freezeRunContextPolicy('normal'),
          contextCompactionMode: 'balanced',
          revision: 1,
        }),
        JSON.stringify({
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
        }),
        JSON.stringify({ schemaVersion: 1, revision: 0, items: [] }),
        JSON.stringify(runUsage),
        now,
        now,
        now,
      ],
    );
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES ('finish-runtime', 'finish-run', 'root', 'native', ?, 'running', 'executing', 0,
               'owner-finish-runtime', ?, ?)`,
      [
        JSON.stringify({ providerId: 'scenario-provider', modelId: 'scenario-model', configurationVersion: 1 }),
        now,
        now,
      ],
    );
    await db.execute(
      `INSERT INTO agent_steps
        (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
         input_refs_json, output_refs_json, created_at)
       VALUES ('finish-step', 'finish-run', 'finish-runtime', 1, 'model', 'running', 0, '[]', '[]', ?)`,
      [now],
    );
    await db.execute(
      `INSERT INTO agent_model_attempts
        (id, step_id, attempt_index, status, reserved_tokens, created_at)
       VALUES ('finish-attempt', 'finish-step', 1, 'streaming', 4096, ?)`,
      [now],
    );

    const settled = await stateCommit.settleModelStep({
      scope,
      runId: 'finish-run',
      runtimeId: 'finish-runtime',
      stepId: 'finish-step',
      attemptId: 'finish-attempt',
      expectedRunVersion: 1,
      assistantEntryId: 'finish-partial-entry',
      assistantText: 'partial output before provider length stop',
      usage: { ...runUsage, inputTokens: 120, outputTokens: 64, steps: 1 },
      inputTokens: 120,
      outputTokens: 64,
      cachedInputTokens: 0,
      estimatedUsage: false,
      finishReason: 'length',
      errorCode: 'MODEL_OUTPUT_TRUNCATED',
      terminalStatus: 'failed',
      now: now + 1,
    });
    assert.equal(settled.run.status, 'failed');
    assert.equal(settled.run.goalStatus, 'not_satisfied');
    assert.equal(settled.run.verificationStatus, 'failed');

    const snapshot = await repository.snapshot(scope, 'finish-run');
    assert.equal(snapshot?.terminalIssue?.errorCode, 'MODEL_OUTPUT_TRUNCATED');
    const partial = await db.queryOne<{ kind: string; payload_json: string }>(
      "SELECT kind, payload_json FROM ai_thread_entries WHERE id = 'finish-partial-entry'",
    );
    assert.equal(partial?.kind, 'assistant_message');
    assert.equal(
      (JSON.parse(partial?.payload_json ?? '{}') as { text?: unknown }).text,
      'partial output before provider length stop',
    );
  } finally {
    await db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }

  return [
    { name: 'finish_reason_policy_cases', value: cases.length, unit: 'cases' },
    { name: 'unsafe_finish_reasons_marked_success', value: 0, unit: 'cases' },
    { name: 'truncated_runs_marked_satisfied', value: 0, unit: 'runs' },
  ];
};

const providerContinuationRoundTripScenario: Scenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-provider-continuation-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'continuation.sqlite', nodeEnv: 'test' });
  const stateCommit = new SqliteStateCommitAdapter(db);
  const repository = new SqliteRunRepository(db);
  const now = 1_800_200_000;
  const runId = 'continuation-run';
  const runtimeId = 'continuation-runtime';
  const threadId = 'continuation-thread';
  const route = {
    providerId: 'scenario-provider',
    modelId: 'scenario-model',
    configurationVersion: 1,
    protocol: 'responses' as const,
  };
  const modelRequest = (providerContinuation?: ModelProviderContinuation): ModelRequest => ({
    userId: 1,
    providerId: route.providerId,
    modelId: route.modelId,
    configurationVersion: route.configurationVersion,
    messages: [
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call-1', name: 'scenario_read', argumentsJson: '{}' }],
        ...(providerContinuation ? { providerContinuation } : {}),
      },
    ],
    maxOutputTokens: 256,
  });
  const makeContinuation = (suffix: string, toolCallId: string): ModelProviderContinuation => {
    const collector = new OpenAiResponsesContinuationCollector();
    collector.recordReasoning({
      openai: {
        itemId: `reasoning-${suffix}`,
        reasoningEncryptedContent: `encrypted-${suffix}`,
      },
    });
    collector.recordToolCall(toolCallId, { openai: { itemId: `item-${suffix}` } });
    const continuation = collector.build(route);
    assert.ok(continuation);
    return continuation;
  };
  const inspection = (toolName: string, operationHash: string): ToolInspection => ({
    toolName,
    toolVersion: '1',
    normalizedArguments: {},
    target: {
      kind: 'run',
      targetIdentity: runId,
      endpoint: runId,
      loginUser: runtimeId,
      configurationHash: 'continuation-fixture',
    },
    resourceKeys: [runId],
    risk: 'read',
    mutation: false,
    operationHash,
    operationHashVersion: 1,
    preconditions: [],
    policyRevision: 1,
    inputRevision: 1,
  });
  const result = (summary: string): ToolResult => ({
    ok: true,
    summary,
    artifactRefs: [],
    truncated: false,
    outcome: 'confirmed',
    verification: { status: 'verified', summary: 'continuation fixture verified', evidenceRefs: [] },
  });

  try {
    const firstContinuation = makeContinuation('one', 'provider-call-1');
    assert.deepEqual(
      decodeOpenAiResponsesContinuation(firstContinuation, modelRequest(firstContinuation), 'responses'),
      [
        { type: 'reasoning', itemId: 'reasoning-one', reasoningEncryptedContent: 'encrypted-one' },
        { type: 'tool-call', toolCallId: 'provider-call-1', itemId: 'item-one' },
      ],
    );
    assert.deepEqual(
      decodeOpenAiResponsesContinuation(
        firstContinuation,
        { ...modelRequest(firstContinuation), configurationVersion: 2 },
        'responses',
      ),
      [],
      'opaque continuation must not cross provider configuration versions',
    );
    assert.deepEqual(
      decodeOpenAiResponsesContinuation(firstContinuation, modelRequest(firstContinuation), 'chat-completions'),
      [],
      'Responses continuation must not cross protocol boundaries',
    );
    const chatCollector = new OpenAiResponsesContinuationCollector();
    chatCollector.recordReasoning({
      openai: { itemId: 'chat-reasoning', reasoningEncryptedContent: 'chat-encrypted' },
    });
    assert.equal(
      chatCollector.build({ ...route, protocol: 'chat-completions' }),
      undefined,
      'Chat Completions must keep the simple path without fabricated continuation state',
    );
    assert.throws(
      () =>
        decodeModelProviderContinuation({
          ...firstContinuation,
          data: { payload: 'x'.repeat(300 * 1024) },
        }),
      /MODEL_PROVIDER_CONTINUATION_TOO_LARGE/,
      'opaque continuation envelopes must be size bounded before durability',
    );

    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'continuation-user', 'not-used')");
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
       VALUES (1, 'scenario-app', '1.0.0', 'enabled', 'running', 1, ?, ?)`,
      [now, now],
    );
    await db.execute(
      `INSERT INTO ai_threads
        (id, user_id, app_id, title, title_source, next_sequence, created_at, updated_at)
       VALUES (?, 1, 'scenario-app', 'continuation', 'manual', 2, ?, ?)`,
      [threadId, now, now],
    );
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
    const definition = {
      schemaVersion: 1,
      agentDefinitionId: 'scenario-agent',
      requiredModelCapabilities: [],
      model: { providerId: route.providerId, modelId: route.modelId, configurationVersion: route.configurationVersion },
      modelCapabilities: SCENARIO_MODEL_CAPABILITIES,
      rootModelRoutes: [],
      approvalMode: 'full_access',
      executionMode: 'execute',
      connectionIds: [],
      environment: null,
      policyRevision: 1,
      settingsRevision: 1,
    };
    const usage = {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      steps: 0,
      subagentMessages: 0,
      subagentMessageBytes: 0,
    };
    await db.execute(
      `INSERT INTO agent_runs
        (id, user_id, app_id, thread_id, status, goal_status, goal_text, goal_revision, goal_updated_at,
         verification_status, budget_json, definition_json, plan_json, usage_json, executing_runtime_count,
         consumed_input_sequence, input_revision, created_at, started_at, updated_at)
       VALUES (?, 1, 'scenario-app', ?, 'running', 'in_progress', 'Use two read tools.', 1, ?,
               'not_started', ?, ?, ?, ?, 0, 0, 1, ?, ?, ?)`,
      [
        runId,
        threadId,
        now,
        JSON.stringify(budget),
        JSON.stringify(definition),
        JSON.stringify({ schemaVersion: 1, revision: 0, items: [] }),
        JSON.stringify(usage),
        now,
        now,
        now,
      ],
    );
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES (?, ?, 'root', 'native', ?, 'running', 'runnable', 0, 'continuation-owner', ?, ?)`,
      [runtimeId, runId, JSON.stringify(definition.model), now, now],
    );
    await db.execute(
      `INSERT INTO ai_thread_entries
        (id, thread_id, user_id, app_id, run_id, sequence, kind, payload_json, created_at)
       VALUES ('continuation-input', ?, 1, 'scenario-app', ?, 1, 'user_input', ?, ?)`,
      [threadId, runId, JSON.stringify({ text: 'Use two read tools.', artifactRefs: [] }), now],
    );

    const runToolRound = async (
      round: number,
      continuation: ModelProviderContinuation,
      providerCallId: string,
    ): Promise<void> => {
      const before = await repository.snapshot(scope, runId);
      assert.ok(before);
      const begun = await stateCommit.beginModelStep({
        scope,
        runId,
        runtimeId,
        expectedRunVersion: before.version,
        inputWatermark: before.inputRevision,
        reservedTokens: 512,
        estimatedInputTokens: 128,
        reservedOutputTokens: 256,
        contextWindowTokens: 16_384,
        now: now + round * 10,
      });
      const proposed = await stateCommit.commitToolProposalBatch({
        scope,
        runId,
        runtimeId,
        modelStepId: begun.stepId,
        attemptId: begun.attemptId,
        expectedRunVersion: begun.run.version,
        assistantEntryId: `continuation-assistant-${round}`,
        assistantText: '',
        items: [
          {
            providerCallId,
            toolCallId: `continuation-tool-${round}`,
            toolName: 'scenario_read',
            toolVersion: '1',
            argumentsJson: '{}',
            inspection: inspection('scenario_read', `continuation-hash-${round}`),
          },
        ],
        usage: begun.run.usage,
        inputTokens: 100 + round,
        outputTokens: 20 + round,
        cachedInputTokens: 40,
        estimatedUsage: false,
        finishReason: 'tool-calls',
        providerContinuation: continuation,
        now: now + round * 10 + 1,
      });
      const item = proposed.items[0]!;
      const started = await stateCommit.beginReadToolBatch({
        scope,
        runId,
        runtimeId,
        expectedRunVersion: proposed.run.version,
        items: [{ toolStepId: item.toolStepId, toolCallId: item.toolCallId }],
        now: now + round * 10 + 2,
      });
      await stateCommit.settleReadToolBatch({
        scope,
        runId,
        runtimeId,
        expectedRunVersion: started.run.version,
        items: [
          {
            toolStepId: item.toolStepId,
            toolCallId: item.toolCallId,
            toolResultEntryId: `continuation-result-${round}`,
            providerCallId,
            result: result(`round ${round} result`),
          },
        ],
        now: now + round * 10 + 3,
      });
    };

    await runToolRound(1, firstContinuation, 'provider-call-1');
    const secondContinuation = makeContinuation('two', 'provider-call-2');
    await runToolRound(2, secondContinuation, 'provider-call-2');

    const rows = await db.queryAll<{ step_id: string; continuation_json: string | null }>(
      `SELECT step_id, continuation_json
       FROM agent_model_attempts
       WHERE continuation_json IS NOT NULL
       ORDER BY created_at, attempt_index`,
    );
    assert.equal(rows.length, 2, 'each completed Responses Tool round must durably own one continuation envelope');

    const freshContinuationRepository = new SqliteModelContinuationRepository(db);
    const modelStepRefs = await db.queryAll<{ id: string }>(
      `SELECT id FROM agent_steps WHERE run_id = ? AND kind = 'model' ORDER BY step_index`,
      [runId],
    );
    const loaded = await freshContinuationRepository.load(
      scope,
      modelStepRefs.map((row) => ({ runId, modelStepId: row.id })),
    );
    const loadedByStep = new Map(loaded.map((item) => [item.modelStepId, item.continuation] as const));
    assert.deepEqual(
      modelStepRefs.map((row) => loadedByStep.get(row.id)),
      [firstContinuation, secondContinuation],
      'restart projection must recover the exact opaque continuation envelopes',
    );

    const freshConversations = new ConversationService(new SqliteConversationRepository(db), clock, null!, null!);
    const freshContext = new ContextService(
      freshConversations,
      new RecallService(new EmptyRecallRepository(), clock),
      new SkillRegistry(),
      freshContinuationRepository,
      null!,
    );
    const contextPlan = await freshContext.compose({
      scope,
      threadId,
      runId,
      currentInput: 'Continue after both tool results.',
      modelContextWindow: 16_384,
      maxContextTokens: 16_384,
      reservedOutputTokens: 512,
      maxRecallItems: 1,
      maxRecallBytes: 1024,
      tools: [],
    });
    const assistantRounds = contextPlan.messages.filter(
      (message) => message.role === 'assistant' && message.toolCalls?.length,
    );
    assert.equal(assistantRounds.length, 2);
    assert.deepEqual(assistantRounds[0]?.providerContinuation, firstContinuation);
    assert.deepEqual(assistantRounds[1]?.providerContinuation, secondContinuation);
    assert.ok(
      contextPlan.estimatedInputTokens > 0 &&
        JSON.stringify(assistantRounds).includes('encrypted-one') &&
        JSON.stringify(assistantRounds).includes('encrypted-two'),
      'opaque continuation must participate in model-facing context reconstruction/accounting',
    );

    const durableAssistantPayloads = await db.queryAll<{ payload_json: string }>(
      `SELECT payload_json FROM ai_thread_entries
       WHERE run_id = ? AND kind = 'assistant_message' ORDER BY sequence`,
      [runId],
    );
    assert.equal(durableAssistantPayloads.length, 2);
    for (const payload of durableAssistantPayloads) {
      const parsed = decodeDurableJsonValue(JSON.parse(payload.payload_json));
      assert.ok(parsed && !Array.isArray(parsed) && typeof parsed === 'object');
      assert.equal(
        'providerContinuation' in parsed,
        false,
        'Ledger must hold only the model-step reference, not a second truth',
      );
      assert.equal(typeof parsed.modelStepId, 'string');
    }

    return [
      { name: 'responses_tool_rounds_with_continuation', value: rows.length, unit: 'rounds' },
      { name: 'restart_continuations_recovered', value: loaded.length, unit: 'rounds' },
      { name: 'cross_route_continuations_reused', value: 0, unit: 'rounds' },
      { name: 'chat_continuations_fabricated', value: 0, unit: 'rounds' },
      { name: 'ledger_duplicate_continuation_truths', value: 0, unit: 'copies' },
      { name: 'oversized_continuations_rejected', value: 1, unit: 'cases' },
    ];
  } finally {
    await db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

const artifactLifecycleSettingsScenario: Scenario = async () => {
  const defaults = createDefaultAgentSettings();
  assert.equal(
    'workspaceIdleTtlSeconds' in defaults.workspaceRuntime,
    false,
    'P-094 must not expose an idle Workspace setting until Workspace activity has a trustworthy runtime owner',
  );
  assert.equal(
    'workspaceIdleTtlSeconds' in defaults.hardLimits,
    false,
    'P-094 must remove the matching fake Workspace idle hard-limit contract',
  );
  const legacyWorkspaceIdle = {
    ...(defaults as unknown as Record<string, unknown>),
    workspaceRuntime: {
      ...(defaults.workspaceRuntime as unknown as Record<string, unknown>),
      workspaceIdleTtlSeconds: 900,
    },
    hardLimits: {
      ...(defaults.hardLimits as unknown as Record<string, unknown>),
      workspaceIdleTtlSeconds: 3_600,
    },
  };
  assert.throws(
    () => normalizeRequestedSettings(legacyWorkspaceIdle),
    /VALIDATION_FAILED/,
    'settings containing removed Workspace idle fields must fail closed',
  );

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-artifact-lifecycle-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'artifact-lifecycle.sqlite', nodeEnv: 'test' });
  const limits = {
    forUser: async () => ({
      maxSingleArtifactBytes: 10,
      maxGlobalArtifactBytes: 100,
      unretainedArtifactTtlSeconds: 2,
      minFreeDiskBytes: 0,
    }),
  } as unknown as ArtifactLimitPolicyPort;
  const store = new LocalArtifactStore(db, limits, { dataDirectory: directory, uploadTtlSeconds: 60 });
  const artifacts = new ArtifactService(store);
  const scope: Scope = { userId: 1, appId: 'artifact-lifecycle-app' };
  const now = Math.floor(Date.now() / 1000);
  const threadId = randomUUID();
  const runId = randomUUID();
  const source = (bytes: Buffer): AsyncIterable<Uint8Array> =>
    (async function* () {
      yield bytes;
    })();
  const writeArtifact = async (name: string, bytes: Buffer) => {
    const reservation = await artifacts.begin(scope, {
      name,
      mediaType: 'application/octet-stream',
      declaredBytes: bytes.byteLength,
    });
    return artifacts.write(scope, reservation.artifactId, source(bytes), new AbortController().signal);
  };

  try {
    await db.initialize();
    await db.execute(
      "INSERT INTO users (id, username, hashed_password) VALUES (1, 'artifact-lifecycle-user', 'not-used')",
    );
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
       VALUES (1, ?, '1.0.0', 'enabled', 'running', 1, ?, ?)`,
      [scope.appId, now, now],
    );
    const settings = createDefaultAgentSettings();
    settings.storage.maxArtifactBytes = 10;
    settings.storage.maxSingleArtifactBytes = 10;
    settings.storage.maxGlobalArtifactBytes = 100;
    settings.storage.unretainedArtifactTtlSeconds = 2;
    settings.hardLimits.maxArtifactBytes = 10;
    settings.hardLimits.maxSingleArtifactBytes = 10;
    settings.hardLimits.maxGlobalArtifactBytes = 100;
    settings.hardLimits.unretainedArtifactTtlSeconds = 2;
    await db.execute('INSERT INTO agent_settings (user_id, value_json, revision, updated_at) VALUES (1, ?, 1, ?)', [
      JSON.stringify(settings),
      now,
    ]);
    await db.execute(
      `INSERT INTO ai_threads (id, user_id, app_id, title, title_source, created_at, updated_at)
       VALUES (?, 1, ?, 'artifact lifecycle', 'manual', ?, ?)`,
      [threadId, scope.appId, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runs
        (id, user_id, app_id, thread_id, status, goal_status, verification_status,
         budget_json, definition_json, plan_json, usage_json, executing_runtime_count,
         created_at, started_at, updated_at)
       VALUES (?, 1, ?, ?, 'running', 'in_progress', 'not_started', '{}', '{}', '{}', '{}', 1, ?, ?, ?)`,
      [runId, scope.appId, threadId, now, now, now],
    );

    const first = await writeArtifact('first.bin', Buffer.alloc(6, 1));
    const second = await writeArtifact('second.bin', Buffer.alloc(6, 2));
    assert.ok(
      first.expiresAt && first.readyAt && first.expiresAt >= first.readyAt + 1,
      'ready unretained Artifacts must receive a durable retention deadline',
    );
    await artifacts.attach(1, first.id, {
      targetAppId: scope.appId,
      threadId,
      runId,
      role: 'input',
    });
    await db.execute(
      `INSERT INTO agent_artifact_links (artifact_id, run_id, role, created_at)
       VALUES (?, ?, 'evidence', ?)`,
      [first.id, runId, now],
    );
    await assert.rejects(
      () =>
        artifacts.attach(1, second.id, {
          targetAppId: scope.appId,
          threadId,
          runId,
          role: 'input',
        }),
      /ARTIFACT_RUN_QUOTA_EXCEEDED/,
      'the second first-time link must be rejected when it would cross the current per-Run artifact quota',
    );

    settings.storage.maxArtifactBytes = 20;
    settings.hardLimits.maxArtifactBytes = 20;
    await db.execute(
      'UPDATE agent_settings SET value_json = ?, revision = revision + 1, updated_at = ? WHERE user_id = 1',
      [JSON.stringify(settings), now + 1],
    );
    await artifacts.attach(1, second.id, {
      targetAppId: scope.appId,
      threadId,
      runId,
      role: 'input',
    });

    const expired = await writeArtifact('expired.bin', Buffer.from('x'));
    await db.execute('UPDATE ai_artifacts SET expires_at = ? WHERE id = ?', [now - 1, expired.id]);
    const retained = await writeArtifact('retained.bin', Buffer.from('r'));
    const retainedUpdated = await artifacts.retain(scope, retained.id, true, retained.version);
    assert.equal(retainedUpdated.expiresAt, null, 'retained Artifacts must not have an automatic expiry deadline');
    await db.execute('UPDATE ai_artifacts SET expires_at = ? WHERE id = ?', [now - 1, retained.id]);
    const protectedArtifact = await writeArtifact('active-run.bin', Buffer.from('p'));
    await artifacts.attach(1, protectedArtifact.id, {
      targetAppId: scope.appId,
      threadId,
      runId,
      role: 'input',
    });
    await db.execute('UPDATE ai_artifacts SET expires_at = ? WHERE id = ?', [now - 1, protectedArtifact.id]);

    const checkpointArtifact = await writeArtifact('checkpoint.bin', Buffer.from('c'));
    await db.execute(
      `INSERT INTO agent_artifact_links (artifact_id, run_id, role, created_at)
       VALUES (?, ?, 'checkpoint', ?)`,
      [checkpointArtifact.id, runId, now],
    );
    await db.execute('UPDATE ai_artifacts SET expires_at = ? WHERE id = ?', [now - 1, checkpointArtifact.id]);

    const grantedArtifact = await writeArtifact('grant.bin', Buffer.from('g'));
    await db.execute(
      `INSERT INTO agent_artifact_grants
        (id, artifact_id, receiver_user_id, receiver_app_id, receiver_thread_id, receiver_run_id,
         scope_key, role, expires_at, revoked_at, created_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, 'input', ?, NULL, ?)`,
      [randomUUID(), grantedArtifact.id, scope.appId, threadId, runId, `run:${runId}`, now + 60, now],
    );
    await db.execute('UPDATE ai_artifacts SET expires_at = ? WHERE id = ?', [now - 1, grantedArtifact.id]);

    const swept = await (store as LocalArtifactStore & { sweepExpired(limit?: number): Promise<number> }).sweepExpired(
      20,
    );
    assert.ok(swept >= 1, 'expired reclaimable Artifacts must be swept');
    assert.equal(await artifacts.get(scope, expired.id), null, 'expired reclaimable Artifact must be deleted');
    assert.equal((await artifacts.get(scope, retained.id))?.status, 'ready');
    assert.equal((await artifacts.get(scope, protectedArtifact.id))?.status, 'ready');
    assert.equal((await artifacts.get(scope, checkpointArtifact.id))?.status, 'ready');
    assert.equal((await artifacts.get(scope, grantedArtifact.id))?.status, 'ready');

    return [
      { name: 'artifact_run_quota_rejections', value: 1, unit: 'cases' },
      { name: 'artifact_run_quota_current_setting_updates', value: 1, unit: 'cases' },
      { name: 'artifact_run_quota_distinct_link_accounting', value: 1, unit: 'cases' },
      { name: 'artifact_ready_ttl_deadlines', value: 1, unit: 'cases' },
      { name: 'artifact_expiry_sweeps', value: swept, unit: 'artifacts' },
      { name: 'artifact_expiry_protected_cases', value: 4, unit: 'artifacts' },
      { name: 'workspace_idle_fake_settings', value: 0, unit: 'settings' },
    ];
  } finally {
    await db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

const artifactModelInputScenario: Scenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-artifact-model-input-'));
  const db = new DatabaseAdapter({
    dataDirectory: directory,
    filename: 'artifact-model-input.sqlite',
    nodeEnv: 'test',
  });
  const limits: ArtifactLimitPolicyPort = {
    forUser: async () => ({
      maxSingleArtifactBytes: 16 * 1024 * 1024,
      maxGlobalArtifactBytes: 64 * 1024 * 1024,
      unretainedArtifactTtlSeconds: 60 * 60,
      minFreeDiskBytes: 0,
    }),
  };
  const store = new LocalArtifactStore(db, limits, { dataDirectory: directory, uploadTtlSeconds: 60 });
  const artifacts = new ArtifactService(store);
  const artifactScope: Scope = { userId: 1, appId: 'artifact-model-app' };
  const now = Math.floor(Date.now() / 1000);
  const threadId = randomUUID();
  const runId = randomUUID();
  const rootRuntimeId = randomUUID();
  const childRuntimeId = randomUUID();
  const delegationId = randomUUID();
  const modelRef = JSON.stringify({
    providerId: 'scenario-provider',
    modelId: 'scenario-model',
    configurationVersion: 1,
  });
  const source = (bytes: Buffer): AsyncIterable<Uint8Array> =>
    (async function* () {
      yield bytes;
    })();

  try {
    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'artifact-model-user', 'not-used')");
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
       VALUES (1, ?, '1.0.0', 'enabled', 'running', 1, ?, ?)`,
      [artifactScope.appId, now, now],
    );
    await db.execute(
      `INSERT INTO ai_threads (id, user_id, app_id, title, title_source, created_at, updated_at)
       VALUES (?, 1, ?, 'artifact model input', 'manual', ?, ?)`,
      [threadId, artifactScope.appId, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runs
        (id, user_id, app_id, thread_id, status, goal_status, verification_status,
         budget_json, definition_json, plan_json, usage_json, executing_runtime_count,
         created_at, started_at, updated_at)
       VALUES (?, 1, ?, ?, 'running', 'in_progress', 'not_started', '{}', '{}', '{}', '{}', 2, ?, ?, ?)`,
      [runId, artifactScope.appId, threadId, now, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES (?, ?, 'root', 'native', ?, 'running', 'executing', 0, ?, ?, ?)`,
      [rootRuntimeId, runId, modelRef, `owner-${rootRuntimeId}`, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES (?, ?, 'child:artifact', 'native', ?, 'running', 'executing', 0, ?, ?, ?)`,
      [childRuntimeId, runId, modelRef, `owner-${childRuntimeId}`, now, now],
    );

    const textBytes = Buffer.from('alpha\nbeta\ngamma\n', 'utf8');
    const largeTextBytes = Buffer.from(
      Array.from({ length: 2400 }, (_, index) => `line-${String(index + 1).padStart(4, '0')} ${'x'.repeat(12)}`).join(
        '\n',
      ),
      'utf8',
    );
    const imageBytes = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

    const writeArtifact = async (name: string, mediaType: string, bytes: Buffer) => {
      const reservation = await artifacts.begin(artifactScope, {
        name,
        mediaType,
        declaredBytes: bytes.byteLength,
      });
      return artifacts.write(artifactScope, reservation.artifactId, source(bytes), new AbortController().signal);
    };

    const textArtifact = await writeArtifact('notes.txt', 'text/plain', textBytes);
    const largeArtifact = await writeArtifact('large.txt', 'text/plain', largeTextBytes);
    const imageArtifact = await writeArtifact('image.png', 'image/png', imageBytes);

    for (const artifactId of [textArtifact.id, largeArtifact.id, imageArtifact.id]) {
      await db.execute(
        `INSERT INTO agent_artifact_links (artifact_id, run_id, role, created_at)
         VALUES (?, ?, 'input', ?)`,
        [artifactId, runId, now],
      );
    }
    await db.execute(
      `INSERT INTO agent_delegations
        (id, run_id, parent_runtime_id, child_runtime_id, profile_id, grants_json, peer_messaging,
         model_ref_json, objective, constraints_json, input_artifact_refs_json, completion_criteria_json,
         dependency_mode, status, depth, failure_mode, max_steps, idempotency_key, request_hash,
         deadline_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'default', ?, 'parent-child', ?, 'read delegated text artifact', '[]', ?, '[]',
               'settled', 'running', 1, 'isolate', 10, ?, ?, ?, ?, ?)`,
      [
        delegationId,
        runId,
        rootRuntimeId,
        childRuntimeId,
        JSON.stringify([{ capability: 'artifacts.read', schemaVersion: 2, scope: { kind: 'global' } }]),
        scenarioDelegationModel(modelRef),
        JSON.stringify([textArtifact.id, largeArtifact.id]),
        `artifact-model-key-${delegationId}`,
        `artifact-model-hash-${delegationId}`,
        now + 600,
        now,
        now,
      ],
    );

    const rootText = await readArtifactTextLinesForAgent(
      artifacts,
      artifactScope,
      { runId, runtimeId: rootRuntimeId },
      textArtifact.id,
      2,
      1,
    );
    assert.equal(rootText.text, 'beta');

    const largeProjection = await projectArtifactsForModel(artifacts, artifactScope, { runId }, [largeArtifact.id], {
      supportsImageInput: false,
      supportsFileInput: false,
    });
    assert.equal(largeProjection.contentParts.length, 0, 'large text must stay in Artifact storage');
    assert.ok(
      largeProjection.textSuffix.includes('"projection":"metadata"'),
      'large text must project metadata instead of full contents',
    );
    const largeRead = await readArtifactTextLinesForAgent(
      artifacts,
      artifactScope,
      { runId, runtimeId: rootRuntimeId },
      largeArtifact.id,
      1500,
      2,
    );
    assert.ok(largeRead.text.startsWith('line-1500 '), 'large Artifact must remain readable on demand');

    const childText = await artifacts.getForAgent(artifactScope, { runId, runtimeId: childRuntimeId }, textArtifact.id);
    const childImage = await artifacts.getForAgent(
      artifactScope,
      { runId, runtimeId: childRuntimeId },
      imageArtifact.id,
    );
    assert.equal(childText?.id, textArtifact.id, 'Child must read explicitly delegated Artifact');
    assert.equal(childImage, null, 'Child must not inherit non-delegated Root Artifact');

    const unsupportedImage = await projectArtifactsForModel(artifacts, artifactScope, { runId }, [imageArtifact.id], {
      supportsImageInput: false,
      supportsFileInput: true,
    });
    assert.equal(unsupportedImage.contentParts.length, 0, 'file capability must not bypass missing image capability');
    assert.ok(unsupportedImage.textSuffix.includes('"projection":"metadata"'));

    const nativeImage = await projectArtifactsForModel(artifacts, artifactScope, { runId }, [imageArtifact.id], {
      supportsImageInput: true,
      supportsFileInput: false,
    });
    assert.equal(nativeImage.contentParts.length, 1);
    assert.equal(nativeImage.contentParts[0]?.type, 'image');
    assert.equal(nativeImage.contentParts[0]?.artifactId, imageArtifact.id);
    assert.equal(
      nativeImage.contentParts[0]?.dataBase64,
      imageBytes.toString('base64'),
      'native image payload must be sourced from canonical Artifact bytes',
    );
    assert.ok(
      nativeImage.textSuffix.includes(imageArtifact.sha256!),
      'model-facing metadata must retain Artifact hash',
    );
    assert.ok(
      nativeImage.textSuffix.includes(artifactScope.appId),
      'model-facing metadata must retain source App provenance',
    );

    const conversations = new ConversationService(new StaticConversationRepository([]), clock, null!, null!);
    const context = new ContextService(
      conversations,
      new RecallService(new EmptyRecallRepository(), clock),
      new SkillRegistry(),
      emptyModelContinuations,
      artifacts,
    );
    const resumed = await context.compose({
      scope: artifactScope,
      threadId,
      runId,
      currentInput: '',
      currentInputArtifactRefs: [textArtifact.id],
      modelInputCapabilities: { supportsImageInput: false, supportsFileInput: false },
      modelContextWindow: 16_384,
      maxContextTokens: 16_384,
      reservedOutputTokens: 512,
      maxRecallItems: 1,
      maxRecallBytes: 1024,
      tools: [],
    });
    const resumedUser = resumed.messages.find((message) => message.role === 'user');
    assert.ok(
      resumedUser?.content.includes('alpha\nbeta\ngamma'),
      'attachment-only resume must project the durable Artifact',
    );
    assert.ok(
      resumedUser?.content.includes(textArtifact.sha256!),
      'resume projection must preserve Artifact hash provenance',
    );

    return [
      { name: 'run_scoped_text_reads', value: 1, unit: 'reads' },
      { name: 'large_artifacts_kept_on_demand', value: 1, unit: 'artifacts' },
      { name: 'child_non_delegated_artifacts_exposed', value: childImage ? 1 : 0, unit: 'artifacts' },
      { name: 'unsupported_images_sent_native', value: unsupportedImage.contentParts.length, unit: 'parts' },
      { name: 'explicit_native_image_parts', value: nativeImage.contentParts.length, unit: 'parts' },
      { name: 'attachment_only_resumes', value: resumedUser ? 1 : 0, unit: 'runs' },
    ];
  } finally {
    await db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

const skillProgressiveDisclosureScenario: Scenario = async () => {
  const skillScope: Scope = { userId: 1, appId: 'scenario.skills' };
  const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
  const standardDocument = (name: string, description: string, body: string) => {
    const content = [
      '---',
      `name: ${name}`,
      `description: "${description}"`,
      'license: Apache-2.0',
      'metadata:',
      '  scenario: "true"',
      'allowed-tools: "Read Grep"',
      '---',
      '',
      `# ${name}`,
      '',
      body,
      '',
    ].join('\n');
    return { path: `skills/${name}/SKILL.md`, content, sha256: sha256(content) };
  };
  const bundle = (documents: PluginSkillBundle['documents']): PluginSkillBundle => ({
    appId: skillScope.appId,
    version: '1.2.3',
    packageHash: sha256(documents.map((document) => document.sha256).join(':')),
    capabilities: [],
    documents,
  });
  class StaticSkillSource implements PluginSkillSourcePort {
    constructor(
      private readonly value: PluginSkillBundle,
      private readonly allowedScope: Scope = skillScope,
    ) {}

    async load(requested: Scope): Promise<PluginSkillBundle | null> {
      if (requested.userId !== this.allowedScope.userId || requested.appId !== this.allowedScope.appId) return null;
      return this.value;
    }
  }
  const composeWithSkills = async (registry: SkillRegistry, currentInput: string, targetScope = skillScope) => {
    const conversations = new ConversationService(new StaticConversationRepository([]), clock, null!, null!);
    return new ContextService(
      conversations,
      new RecallService(new EmptyRecallRepository(), clock),
      registry,
      emptyModelContinuations,
      null!,
    ).compose({
      scope: targetScope,
      threadId: 'skill-progressive-thread',
      runId: 'skill-progressive-run',
      currentInput,
      modelContextWindow: 16_384,
      maxContextTokens: 16_384,
      reservedOutputTokens: 512,
      maxRecallItems: 1,
      maxRecallBytes: 1024,
      tools: [],
    });
  };

  const lowDocuments = [
    standardDocument(
      'project-planner',
      'Plan implementation work while keeping signed Skill instructions on demand.',
      'STANDARD_BODY_ON_DEMAND_ONLY',
    ),
    standardDocument(
      'operations',
      'Investigate operational state using signed Skill instructions loaded on demand.',
      'OPERATIONS_BODY_ON_DEMAND_ONLY',
    ),
  ];
  const lowRegistry = new SkillRegistry(new StaticSkillSource(bundle(lowDocuments)));
  const lowMetadata = await lowRegistry.list(skillScope);
  assert.deepEqual(
    lowMetadata.map((item) => item.id).sort(),
    ['scenario.skills.operations', 'scenario.skills.project-planner'],
    'SKILL.md identity must derive only from the signed App id and canonical Skill name',
  );
  assert.equal(
    lowMetadata.find((item) => item.id === 'scenario.skills.project-planner')?.version,
    '1.2.3',
    'standard SKILL.md version must derive from the signed plugin version rather than document-authored authority',
  );
  const lowPlan = await composeWithSkills(lowRegistry, 'Plan a small implementation.');
  const lowSkillInstructions = lowPlan.instructions.find((item) => item.startsWith('[Available signed plugin Skills;'));
  assert.ok(lowSkillInstructions?.includes('scenario.skills.project-planner'));
  assert.ok(lowSkillInstructions?.includes('scenario.skills.operations'));
  assert.ok(!lowSkillInstructions?.includes('STANDARD_BODY_ON_DEMAND_ONLY'));
  assert.ok(!lowSkillInstructions?.includes('OPERATIONS_BODY_ON_DEMAND_ONLY'));
  assert.ok(
    !lowSkillInstructions?.includes('allowed-tools'),
    'Agent Skills allowed-tools metadata must not become Nexus model-facing authority',
  );

  const targetDocument = standardDocument(
    'incident-triage',
    'Investigate orbital telemetry 项目 regression and canary drift with bounded evidence.',
    'HIGH_TARGET_BODY_ON_DEMAND_ONLY',
  );
  const fillerDocuments = Array.from({ length: 47 }, (_, index) =>
    standardDocument(
      `skill-${String(index).padStart(2, '0')}`,
      `Routine maintenance workflow ${String(index).padStart(2, '0')} for ordinary service checks.`,
      `FILLER_BODY_${index}`,
    ),
  );
  const mediumRegistry = new SkillRegistry(
    new StaticSkillSource(bundle([targetDocument, ...fillerDocuments.slice(0, 15)])),
  );
  const highRegistry = new SkillRegistry(new StaticSkillSource(bundle([targetDocument, ...fillerDocuments])));
  const highInput = 'Investigate the orbital telemetry 项目 regression and canary drift.';
  const [mediumPlan, highPlan] = await Promise.all([
    composeWithSkills(mediumRegistry, highInput),
    composeWithSkills(highRegistry, highInput),
  ]);
  const mediumInstructions = mediumPlan.instructions.find((item) =>
    item.startsWith('[Available signed plugin Skills;'),
  );
  const highInstructions = highPlan.instructions.find((item) => item.startsWith('[Available signed plugin Skills;'));
  assert.ok(mediumInstructions?.includes('indexed metadata projection'));
  assert.ok(highInstructions?.includes('indexed metadata projection'));
  assert.ok(
    highInstructions?.includes('scenario.skills.incident-triage'),
    'relevant high-cardinality Skill must be injected',
  );
  assert.ok(
    highInstructions?.includes('skill_search'),
    'indexed projection must teach the model how to discover more Skills',
  );
  assert.ok(!highInstructions?.includes('HIGH_TARGET_BODY_ON_DEMAND_ONLY'), 'Skill body must remain out of the prompt');
  const injectedMetadataCount = highInstructions?.match(/\n- id:/g)?.length ?? 0;
  assert.ok(injectedMetadataCount <= 6, 'high-cardinality prompt metadata must remain bounded');
  const mediumSkillTokens = Math.ceil(Buffer.byteLength(mediumInstructions ?? '', 'utf8') / 4);
  const highSkillTokens = Math.ceil(Buffer.byteLength(highInstructions ?? '', 'utf8') / 4);
  assert.equal(
    highSkillTokens,
    mediumSkillTokens,
    'growing the catalog from 16 to 48 Skills with the same relevant match must not linearly grow Skill system tokens',
  );

  const searchMatches = await highRegistry.search(skillScope, 'orbital telemetry 项目 regression', 3);
  assert.equal(
    searchMatches[0]?.id,
    'scenario.skills.incident-triage',
    'bounded indexed discovery must rank the target first',
  );
  assert.ok(searchMatches.length <= 3);

  const cryptoHash = { sha256Utf8: sha256 };
  const toolContext: ToolContext = {
    ...skillScope,
    actor: {
      kind: 'agent',
      userId: skillScope.userId,
      appId: skillScope.appId,
      runId: 'skill-progressive-run',
      agentRuntimeId: 'skill-progressive-runtime',
    },
    runId: 'skill-progressive-run',
    agentRuntimeId: 'skill-progressive-runtime',
    connectionIds: [],
    environment: null,
    stepId: 'skill-progressive-step',
    signal: new AbortController().signal,
    deadlineAt: clock.nowUnixSeconds() + 60,
    maxOutputBytes: 16 * 1024,
    inputRevision: 1,
  };
  const searchTool = createSkillSearchTool(highRegistry, cryptoHash);
  const searchInspection = await searchTool.inspect(
    { query: 'orbital telemetry 项目 regression', limit: 3 },
    toolContext,
    1,
  );
  const searchResult = await searchTool.execute(searchInspection, toolContext);
  assert.ok(JSON.stringify(searchResult.data).includes('scenario.skills.incident-triage'));
  assert.ok(
    !JSON.stringify(searchResult.data).includes('HIGH_TARGET_BODY_ON_DEMAND_ONLY'),
    'skill_search must return metadata only',
  );

  const readTool = createSkillReadTool(highRegistry, cryptoHash);
  const readInspection = await readTool.inspect({ id: 'scenario.skills.incident-triage' }, toolContext, 1);
  const readResult = await readTool.execute(readInspection, toolContext);
  assert.ok(
    JSON.stringify(readResult.data).includes('HIGH_TARGET_BODY_ON_DEMAND_ONLY'),
    'skill_read must load the signed body only after explicit selection',
  );

  const unauthorizedScope: Scope = { userId: 2, appId: skillScope.appId };
  assert.deepEqual(
    await highRegistry.search(unauthorizedScope, 'orbital telemetry 项目 regression', 3),
    [],
    'a scope that cannot load the installed signed plugin must not discover Skill metadata',
  );
  const unauthorizedPlan = await composeWithSkills(highRegistry, highInput, unauthorizedScope);
  assert.equal(
    unauthorizedPlan.instructions.some((item) => item.startsWith('[Available signed plugin Skills;')),
    false,
    'unauthorized scope must not receive Skill prompt metadata',
  );

  const tamperedTarget = { ...targetDocument, sha256: '0'.repeat(64) };
  const tamperedRegistry = new SkillRegistry(new StaticSkillSource(bundle([tamperedTarget])));
  await assert.rejects(
    tamperedRegistry.list(skillScope),
    /PLUGIN_SKILL_CHANGED/,
    'a Skill whose bytes do not match the signed file hash must fail closed before metadata disclosure',
  );
  const removedFormatContent = [
    '---',
    'id: scenario.removed-format',
    'name: removed-format',
    'version: 1.0.0',
    'description: Removed Nexus-specific Skill metadata must be rejected.',
    'requiredCapabilities: file.read',
    '---',
    '',
    '# Removed format',
    '',
    'REMOVED_FORMAT_BODY',
    '',
  ].join('\n');
  const removedFormatRegistry = new SkillRegistry(
    new StaticSkillSource(
      bundle([
        {
          path: 'skills/removed-format/SKILL.md',
          content: removedFormatContent,
          sha256: sha256(removedFormatContent),
        },
      ]),
    ),
  );
  await assert.rejects(
    removedFormatRegistry.list(skillScope),
    /Invalid Skill metadata/,
    'removed Nexus-specific Skill frontmatter must fail closed instead of entering a compatibility branch',
  );
  assert.throws(
    () =>
      validatePluginSkillDocument(
        removedFormatContent,
        'skills/removed-format/SKILL.md',
        sha256(removedFormatContent),
        { appId: skillScope.appId, version: '1.2.3' },
      ),
    /PLUGIN_SKILL_DOCUMENT_INVALID/,
    'plugin package verification must reject removed Nexus-specific Skill frontmatter before installation',
  );
  const degradedPlan = await composeWithSkills(
    removedFormatRegistry,
    'Continue safely even when the optional signed Skill catalog is invalid.',
  );
  assert.ok(
    degradedPlan.droppedSections.includes('skill-catalog:unavailable'),
    'Context composition must record unavailable Skill metadata without aborting the root model step',
  );
  assert.equal(
    degradedPlan.instructions.some((item) => item.startsWith('[Available signed plugin Skills;')),
    false,
    'an invalid Skill catalog must fail closed instead of entering the model prompt',
  );

  return [
    { name: 'low_cardinality_metadata_exposed', value: lowMetadata.length, unit: 'skills' },
    { name: 'high_cardinality_catalog_size', value: 48, unit: 'skills' },
    { name: 'high_cardinality_prompt_metadata', value: injectedMetadataCount, unit: 'skills' },
    { name: 'high_cardinality_skill_tokens', value: highSkillTokens, unit: 'tokens' },
    { name: 'bounded_search_results', value: searchMatches.length, unit: 'skills' },
    { name: 'skill_bodies_prompt_resident', value: 0, unit: 'bodies' },
    { name: 'trust_scope_leaks', value: 0, unit: 'skills' },
  ];
};

const indexedRecallScenario: Scenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-indexed-recall-'));
  const databasePath = path.join(directory, 'indexed-recall.sqlite');
  let db: DatabaseAdapter | null = new DatabaseAdapter({
    dataDirectory: directory,
    filename: 'indexed-recall.sqlite',
    nodeEnv: 'test',
  });
  const indexedScope: Scope = { userId: 1, appId: 'indexed-recall-app' };
  const threadId = 'indexed-recall-thread';
  const now = 1_800_950_000;

  try {
    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'indexed-recall-user', 'not-used')");
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
       VALUES (1, ?, '1.0.0', 'enabled', 'running', 1, ?, ?)`,
      [indexedScope.appId, now, now],
    );
    await db.execute(
      `INSERT INTO ai_threads
        (id, user_id, app_id, title, title_source, next_sequence, created_at, updated_at)
       VALUES (?, 1, ?, 'Indexed recall', 'manual', 1001, ?, ?)`,
      [threadId, indexedScope.appId, now, now],
    );

    await db.execute(
      `WITH RECURSIVE seq(x) AS (
         SELECT 1
         UNION ALL
         SELECT x + 1 FROM seq WHERE x < 1200
       )
       INSERT INTO ai_memories
         (id, user_id, app_id, content, source_refs_json, confidence, status, created_at, updated_at)
       SELECT printf('memory-filler-%04d', x), 1, ?, 'irrelevant memory filler ' || x, '[]', 0.5, 'published', ?, ?
       FROM seq`,
      [indexedScope.appId, now - 1, now - 1],
    );
    await db.execute(
      `INSERT INTO ai_memories
        (id, user_id, app_id, content, source_refs_json, confidence, status, created_at, updated_at)
       VALUES
        ('memory-english-target', 1, ?, 'Keep ContinuationNeedleID as the durable continuation authority.', '[]', 0.9, 'published', ?, ?),
        ('memory-cjk-target', 1, ?, '项目约束：索引必须支持两个汉字的查询。', '[]', 0.9, 'published', ?, ?)`,
      [indexedScope.appId, now - 10_000, now - 10_000, indexedScope.appId, now - 10_000, now - 10_000],
    );

    await db.execute(
      `WITH RECURSIVE seq(x) AS (
         SELECT 1
         UNION ALL
         SELECT x + 1 FROM seq WHERE x < 1000
       )
       INSERT INTO ai_thread_entries
         (id, thread_id, user_id, app_id, sequence, kind, payload_json, created_at)
       SELECT printf('entry-%04d', x), ?, 1, ?, x, 'user_input',
              json_object('text', 'historical filler ' || x), ?
       FROM seq`,
      [threadId, indexedScope.appId, now],
    );
    await db.execute(
      `UPDATE ai_thread_entries
       SET payload_json = json_object('text', 'Earlier decision: keep ContinuationNeedleID authority in durable state.')
       WHERE thread_id = ? AND sequence = 20`,
      [threadId],
    );
    await db.execute(
      `UPDATE ai_thread_entries
       SET payload_json = json_object('text', '项目历史约束：短中文检索必须命中索引。')
       WHERE thread_id = ? AND sequence = 21`,
      [threadId],
    );

    const indexedClock: ClockPort = { nowUnixSeconds: () => now };
    const recall = new RecallService(new SqliteRecallRepository(db), indexedClock);
    const englishMemory = await recall.recall(indexedScope, 'ContinuationNeedleID', 5, 8_192);
    assert.equal(
      englishMemory[0]?.id,
      'memory-english-target',
      'indexed Memory recall must find a target older than the former 1000-row recency scan',
    );
    const cjkMemory = await recall.recall(indexedScope, '项目', 5, 8_192);
    assert.equal(cjkMemory[0]?.id, 'memory-cjk-target', 'two-character CJK Memory query must use indexed retrieval');

    const conversationRepository = new SqliteConversationRepository(db);
    const conversations = new ConversationService(conversationRepository, indexedClock, null!, null!);
    const context = new ContextService(
      conversations,
      new RecallService(new EmptyRecallRepository(), indexedClock),
      new SkillRegistry(),
      emptyModelContinuations,
      null!,
    );

    const englishContext = await context.compose({
      scope: indexedScope,
      threadId,
      currentInput: 'ContinuationNeedleID',
      modelContextWindow: 32_768,
      maxContextTokens: 32_768,
      reservedOutputTokens: 1_024,
      maxRecallItems: 5,
      maxRecallBytes: 8_192,
      tools: [],
    });
    assert.ok(
      englishContext.sourceRanges.some((source) => source.kind === 'thread_recall' && source.id === 'entry-0020'),
      'Earlier-thread indexed retrieval must find an entry outside the former 800-row scan',
    );

    const cjkContext = await context.compose({
      scope: indexedScope,
      threadId,
      currentInput: '项目',
      modelContextWindow: 32_768,
      maxContextTokens: 32_768,
      reservedOutputTokens: 1_024,
      maxRecallItems: 5,
      maxRecallBytes: 8_192,
      tools: [],
    });
    assert.ok(
      cjkContext.sourceRanges.some((source) => source.kind === 'thread_recall' && source.id === 'entry-0021'),
      'two-character CJK Earlier-thread query must use indexed retrieval',
    );

    const boundedMemoryCandidates = await new SqliteRecallRepository(db).searchPublishedCandidates(
      indexedScope,
      now,
      ['ContinuationNeedleID'],
      24,
    );
    assert.ok(boundedMemoryCandidates.length <= 24, 'Memory first-stage retrieval must obey its candidate bound');
    const boundedThreadCandidates = await conversationRepository.searchEarlierEntries(
      indexedScope,
      threadId,
      ['ContinuationNeedleID'],
      841,
      64,
    );
    assert.ok(
      boundedThreadCandidates.length <= 64,
      'Earlier-thread first-stage retrieval must obey its candidate bound',
    );

    await db.close();
    db = null;

    const raw = new DatabaseSync(databasePath);
    try {
      raw.exec('DROP TABLE ai_memories_search; DROP TABLE ai_thread_entries_search;');
    } finally {
      raw.close();
    }

    db = new DatabaseAdapter({ dataDirectory: directory, filename: 'indexed-recall.sqlite', nodeEnv: 'test' });
    await db.initialize();
    const repairedRecall = await new RecallService(new SqliteRecallRepository(db), indexedClock).recall(
      indexedScope,
      '项目',
      5,
      8_192,
    );
    assert.equal(
      repairedRecall[0]?.id,
      'memory-cjk-target',
      'missing derived FTS tables must rebuild from canonical Memory/Ledger rows on startup',
    );
    const repairedThread = await new SqliteConversationRepository(db).searchEarlierEntries(
      indexedScope,
      threadId,
      ['项目'],
      841,
      64,
    );
    assert.ok(
      repairedThread.some((entry) => entry.id === 'entry-0021'),
      'rebuilt Earlier-thread index must recover canonical CJK history',
    );

    return [
      { name: 'memory_rows_beyond_old_scan_found', value: 2, unit: 'queries' },
      { name: 'thread_rows_beyond_old_scan_found', value: 2, unit: 'queries' },
      { name: 'max_memory_candidate_rows', value: boundedMemoryCandidates.length, unit: 'rows' },
      { name: 'max_thread_candidate_rows', value: boundedThreadCandidates.length, unit: 'rows' },
      { name: 'two_character_cjk_indexed_queries', value: 2, unit: 'queries' },
      { name: 'derived_indexes_rebuilt', value: 2, unit: 'indexes' },
    ];
  } finally {
    await db?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

const modelCapabilityRegistrySyncScenario: Scenario = async () => {
  const generatedAt = clock.nowUnixSeconds() - 60;
  const models = Object.fromEntries(
    Array.from({ length: 30 }, (_, index) => [
      index === 0 ? 'sync-model' : `sync-model-${index}`,
      {
        limit: { context: 32_768 + index, output: 4_096 },
        tool_call: true,
        reasoning: index === 0,
        reasoning_options: index === 0 ? [{ type: 'effort', values: ['low', 'high'] }] : [],
        modalities: { input: index === 0 ? ['text', 'image', 'pdf'] : ['text'], output: ['text'] },
      },
    ]),
  );
  const snapshot = parseModelsDevRegistry(
    { openai: { models } },
    { generatedAt, sourceRevision: 'scenario-revision-1' },
  );
  assert.equal(snapshot.entries['sync-model']?.contextWindow, 32_768);
  assert.equal(snapshot.entries['sync-model']?.maxOutputTokens, 4_096);
  assert.equal(snapshot.entries['sync-model']?.supportsTools, true);
  assert.equal(snapshot.entries['sync-model']?.supportsImageInput, true);
  assert.equal(snapshot.entries['sync-model']?.supportsFileInput, true);
  assert.deepEqual(snapshot.entries['sync-model']?.reasoning?.supportedEfforts, ['low', 'high']);
  assert.equal(snapshot.entries['openai/sync-model']?.contextWindow, 32_768);

  class MemoryRegistryStore implements ModelCapabilityRegistryStorePort {
    state: ModelCapabilityRegistryPersistedState | null = {
      schemaVersion: 1,
      autoUpdate: false,
      snapshot: null,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastErrorCode: null,
    };

    async load(): Promise<ModelCapabilityRegistryPersistedState | null> {
      return this.state ? structuredClone(this.state) : null;
    }

    async save(state: ModelCapabilityRegistryPersistedState): Promise<void> {
      this.state = structuredClone(state);
    }
  }

  class ScriptedRegistrySource implements ModelCapabilityRegistrySourcePort {
    result: ModelCapabilityRegistryFetchResult = { state: 'updated', snapshot };
    failure: Error | null = null;
    calls = 0;

    async fetch(): Promise<ModelCapabilityRegistryFetchResult> {
      this.calls += 1;
      if (this.failure) throw this.failure;
      return structuredClone(this.result);
    }
  }

  const store = new MemoryRegistryStore();
  const source = new ScriptedRegistrySource();
  const registry = new ModelCapabilityRegistryService(store, source, clock);

  try {
    await registry.initialize();
    assert.equal(registry.status().activeSource, 'builtin');
    assert.equal(registry.status().autoUpdate, false);

    const updated = await registry.refresh();
    assert.equal(updated.activeSource, 'updated');
    assert.equal(updated.entryCount, Object.keys(snapshot.entries).length);
    assert.equal(updated.sourceRevision, 'scenario-revision-1');
    assert.equal(source.calls, 1);

    const runtimeModel = resolveModelCapabilityDefaults('sync-model');
    assert.equal(runtimeModel?.contextWindow, 32_768);
    assert.deepEqual(runtimeModel?.reasoning?.supportedEfforts, ['low', 'high']);

    const enabled = await registry.setAutoUpdate(true);
    assert.equal(enabled.autoUpdate, true);
    assert.equal(store.state?.autoUpdate, true);

    source.failure = new Error('MODEL_REGISTRY_HTTP_503');
    await assert.rejects(() => registry.refresh(), /MODEL_REGISTRY_HTTP_503/);
    assert.equal(registry.status().lastErrorCode, 'MODEL_REGISTRY_HTTP_503');
    assert.equal(resolveModelCapabilityDefaults('sync-model')?.contextWindow, 32_768);
  } finally {
    registry.dispose();
    installRuntimeModelCapabilityRegistry(null);
  }

  return [
    { name: 'synced_model_identifiers', value: Object.keys(snapshot.entries).length, unit: 'models' },
    { name: 'manual_refresh_calls', value: source.calls, unit: 'calls' },
    { name: 'update_failure_preserved_snapshot', value: 1, unit: 'boolean' },
  ];
};

const providerLiveCapabilityAuthorityScenario: Scenario = async () => {
  const registryOnly = resolveProviderModelConfig({ id: 'gpt-4o' });
  assert.equal(registryOnly.contextWindow, 128_000);
  assert.equal(registryOnly.maxOutputTokens, 16_384);
  assert.equal(registryOnly.capabilitySources.contextWindow, 'registry');
  assert.equal(registryOnly.capabilitySources.supportsImageInput, 'registry');

  const providerOnly: ProviderModelCapabilityObservation = {
    modelId: 'private-live-model',
    source: 'scenario-provider',
    sourceVersion: 'capabilities-v1',
    capabilities: {
      contextWindow: 64_000,
      maxOutputTokens: 8_000,
      supportsTools: false,
      supportsImageInput: true,
      reasoning: {
        supportedEfforts: ['low', 'high'],
        defaultEffort: 'low',
      },
    },
    updatedAt: clock.nowUnixSeconds(),
  };
  const providerOnlyResolved = resolveProviderModelConfig({ id: providerOnly.modelId }, providerOnly);
  assert.equal(providerOnlyResolved.contextWindow, 64_000);
  assert.equal(providerOnlyResolved.maxOutputTokens, 8_000);
  assert.equal(providerOnlyResolved.capabilitySources.contextWindow, 'provider');
  assert.equal(providerOnlyResolved.capabilitySources.supportsTools, 'provider');
  assert.equal(providerOnlyResolved.capabilitySources.reasoning, 'provider');

  const mixedObservation: ProviderModelCapabilityObservation = {
    modelId: 'gpt-4o',
    source: 'scenario-provider',
    sourceVersion: 'partial-v1',
    capabilities: { maxOutputTokens: 8_192 },
    updatedAt: clock.nowUnixSeconds(),
  };
  const mixed = resolveProviderModelConfig({ id: 'gpt-4o' }, mixedObservation);
  assert.equal(mixed.contextWindow, 128_000);
  assert.equal(mixed.maxOutputTokens, 8_192);
  assert.equal(mixed.supportsTools, true);
  assert.equal(mixed.capabilitySources.contextWindow, 'registry');
  assert.equal(mixed.capabilitySources.maxOutputTokens, 'provider');
  assert.equal(mixed.capabilitySources.supportsTools, 'registry');
  assert.ok(mixed.capabilityConflicts?.includes('maxOutputTokens'));

  const allThree = resolveProviderModelConfig(
    {
      id: 'gpt-4o',
      capabilityOverrides: {
        maxOutputTokens: 4_096,
        supportsTools: false,
      },
    },
    {
      ...mixedObservation,
      capabilities: { maxOutputTokens: 8_192, supportsTools: true },
    },
  );
  assert.equal(allThree.maxOutputTokens, 4_096);
  assert.equal(allThree.supportsTools, false);
  assert.equal(allThree.capabilitySources.maxOutputTokens, 'manual');
  assert.equal(allThree.capabilitySources.supportsTools, 'manual');
  assert.ok(allThree.capabilityConflicts?.includes('maxOutputTokens'));
  assert.ok(allThree.capabilityConflicts?.includes('supportsTools'));

  assert.deepEqual(
    deriveCapabilityOverrides(
      providerOnly.modelId,
      {
        contextWindow: providerOnlyResolved.contextWindow,
        maxOutputTokens: providerOnlyResolved.maxOutputTokens,
        supportsTools: providerOnlyResolved.supportsTools,
        supportsImageInput: providerOnlyResolved.supportsImageInput,
        supportsFileInput: providerOnlyResolved.supportsFileInput,
        reasoningEfforts: providerOnlyResolved.reasoningEfforts,
        defaultReasoningEffort: providerOnlyResolved.defaultReasoningEffort,
      },
      providerOnly,
    ),
    {},
    'Posting provider-derived effective values must not manufacture manual overrides',
  );
  assert.deepEqual(
    deriveCapabilityOverrides(
      providerOnly.modelId,
      {
        contextWindow: 48_000,
        maxOutputTokens: providerOnlyResolved.maxOutputTokens,
        supportsTools: providerOnlyResolved.supportsTools,
        supportsImageInput: providerOnlyResolved.supportsImageInput,
        supportsFileInput: providerOnlyResolved.supportsFileInput,
        reasoningEfforts: providerOnlyResolved.reasoningEfforts,
        defaultReasoningEffort: providerOnlyResolved.defaultReasoningEffort,
      },
      providerOnly,
    ),
    { contextWindow: 48_000 },
  );

  assert.ok(resolveModelCapabilityDefaults('gpt-5.6-sol-2026-09-18'));
  assert.equal(resolveModelCapabilityDefaults('gpt-5.6-sol-preview'), null);
  assert.equal(resolveModelCapabilityDefaults('proxy-gpt-4o'), null);
  assert.throws(() => resolveProviderModelConfig({ id: 'proxy-gpt-4o' }), /MODEL_CAPABILITY_INCOMPLETE/);

  const persisted: PersistedProviderView = {
    id: 'live-authority-provider',
    kind: 'openai-compatible',
    displayName: 'Live authority provider',
    baseUrl: 'http://scenario.invalid/v1',
    protocol: 'chat-completions',
    hasCredential: false,
    credentialRevision: 1,
    models: [{ id: providerOnly.modelId }],
    liveCapabilities: [],
    enabled: true,
    version: 7,
    createdAt: clock.nowUnixSeconds(),
    updatedAt: clock.nowUnixSeconds(),
  };
  const repository = new StaticProviderRepository(persisted);
  const v1Discovery = new ScriptedLanguageModel(
    [],
    [
      {
        id: providerOnly.modelId,
        liveCapabilityReport: {
          source: providerOnly.source,
          sourceVersion: providerOnly.sourceVersion,
          capabilities: providerOnly.capabilities,
        },
      },
    ],
  );
  const serviceV1 = new ProviderService(repository, v1Discovery, clock);
  const discoveredV1 = await serviceV1.discoverModels(1, persisted.id);
  assert.equal(discoveredV1[0]?.providerCapabilities?.sourceVersion, 'capabilities-v1');
  assert.equal(persisted.version, 7, 'Live capability refresh must not bump provider configurationVersion');
  const effectiveV1 = await serviceV1.get(1, persisted.id);
  assert.equal(effectiveV1.models[0]?.contextWindow, 64_000);
  assert.equal(effectiveV1.models[0]?.capabilitySources.contextWindow, 'provider');

  const frozen = snapshotProviderModelCapabilities(effectiveV1.models[0]!);
  const durableDefinition = parseRunDefinition(
    JSON.stringify({
      schemaVersion: 1,
      agentDefinitionId: 'scenario-agent',
      requiredModelCapabilities: [],
      model: {
        providerId: persisted.id,
        modelId: providerOnly.modelId,
        configurationVersion: persisted.version,
      },
      modelCapabilities: frozen,
      rootModelRoutes: [],
      approvalMode: 'ask',
      executionMode: 'execute',
      connectionIds: [],
      environment: null,
      policyRevision: 1,
      settingsRevision: 1,
    }),
  );
  assert.deepEqual(durableDefinition.modelCapabilities, frozen);

  const v2Discovery = new ScriptedLanguageModel(
    [],
    [
      {
        id: providerOnly.modelId,
        liveCapabilityReport: {
          source: providerOnly.source,
          sourceVersion: 'capabilities-v2',
          capabilities: {
            contextWindow: 96_000,
            maxOutputTokens: 12_000,
            supportsTools: true,
            supportsImageInput: false,
          },
        },
      },
    ],
  );
  const serviceV2 = new ProviderService(repository, v2Discovery, clock);
  await serviceV2.discoverModels(1, persisted.id);
  const effectiveV2 = await serviceV2.get(1, persisted.id);
  assert.equal(effectiveV2.models[0]?.contextWindow, 96_000);
  assert.equal(effectiveV2.models[0]?.providerCapabilities?.sourceVersion, 'capabilities-v2');
  assert.equal(persisted.version, 7);

  const frozenDuringRefresh = applyModelCapabilitySnapshot(effectiveV2.models[0]!, durableDefinition.modelCapabilities);
  assert.equal(frozenDuringRefresh.contextWindow, 64_000);
  assert.equal(frozenDuringRefresh.maxOutputTokens, 8_000);
  assert.equal(frozenDuringRefresh.supportsTools, false);
  assert.equal(frozenDuringRefresh.supportsImageInput, true);

  const genericDiscovery = new ProviderService(
    repository,
    new ScriptedLanguageModel([], [{ id: providerOnly.modelId, ownedBy: 'generic-compatible' }]),
    clock,
  );
  const genericResult = await genericDiscovery.discoverModels(1, persisted.id);
  assert.equal(genericResult[0]?.providerCapabilities?.sourceVersion, 'capabilities-v2');
  assert.equal(
    persisted.liveCapabilities[0]?.sourceVersion,
    'capabilities-v2',
    'Identifier-only /models discovery must not invent or erase capability observations',
  );

  const explicitMetadata = {
    schema_version: 1,
    context_window: 72_000,
    max_output_tokens: 9_000,
    supports_tools: true,
    supports_image_input: false,
    supports_file_input: true,
    supports_prompt_cache_key: true,
    reasoning: {
      supported_efforts: ['high', 'low'],
      default_effort: 'high',
      mandatory: false,
    },
  };
  const parsedExplicit = parseOpenAiCompatibleCapabilityMetadata(explicitMetadata, 'https://capabilities.example/v1');
  assert.deepEqual(parsedExplicit?.capabilities, {
    contextWindow: 72_000,
    maxOutputTokens: 9_000,
    supportsTools: true,
    supportsImageInput: false,
    supportsFileInput: true,
    supportsPromptCacheKey: true,
    reasoning: {
      supportedEfforts: ['low', 'high'],
      defaultEffort: 'high',
      mandatory: false,
    },
  });
  assert.match(parsedExplicit?.source ?? '', /^openai-compatible:[A-Za-z0-9_-]{43}:\/models:nexus_capabilities$/);
  assert.match(parsedExplicit?.sourceVersion ?? '', /^schema-1:sha256:[A-Za-z0-9_-]{43}$/);
  const sameCapabilitiesOtherEndpoint = parseOpenAiCompatibleCapabilityMetadata(
    { ...explicitMetadata },
    'https://other-capabilities.example/v1',
  );
  assert.notEqual(
    sameCapabilitiesOtherEndpoint?.source,
    parsedExplicit?.source,
    'Capability authority source must be bound to the configured Provider endpoint',
  );
  assert.equal(
    sameCapabilitiesOtherEndpoint?.sourceVersion,
    parsedExplicit?.sourceVersion,
    'Capability revision must describe normalized capability content independently of endpoint identity',
  );
  assert.equal(
    parseOpenAiCompatibleCapabilityMetadata({ ...explicitMetadata }, 'https://capabilities.example/v1')?.sourceVersion,
    parsedExplicit?.sourceVersion,
    'Capability source revision must be deterministic for equivalent normalized metadata',
  );
  assert.notEqual(
    parseOpenAiCompatibleCapabilityMetadata(
      { ...explicitMetadata, max_output_tokens: 9_001 },
      'https://capabilities.example/v1',
    )?.sourceVersion,
    parsedExplicit?.sourceVersion,
    'Capability source revision must change when normalized capability content changes',
  );
  assert.equal(parseOpenAiCompatibleCapabilityMetadata(undefined, 'https://capabilities.example/v1'), undefined);
  for (const invalidMetadata of [
    { schema_version: 2, supports_tools: true },
    { schema_version: 1 },
    { schema_version: 1, context_window: 4_096, max_output_tokens: 8_192 },
    { schema_version: 1, supports_tools: 'yes' },
    { schema_version: 1, supports_tools: true, inferred_from_name: true },
    { schema_version: 1, reasoning: { supported_efforts: ['low', 'turbo'] } },
  ]) {
    assert.throws(
      () => parseOpenAiCompatibleCapabilityMetadata(invalidMetadata, 'https://capabilities.example/v1'),
      /PROVIDER_CAPABILITY_METADATA_INVALID/,
    );
  }

  const adapterProvider: ProviderView = {
    id: 'adapter-live-provider',
    kind: 'openai-compatible',
    displayName: 'Adapter live provider',
    baseUrl: 'https://capabilities.example/v1',
    protocol: 'chat-completions',
    hasCredential: true,
    credentialRevision: 3,
    models: [],
    enabled: true,
    version: 11,
    createdAt: 1,
    updatedAt: 1,
  };
  const adapter = new OpenAiProviderAdapter(
    { get: async () => adapterProvider },
    {
      withCredential: async <T>(
        _userId: number,
        _providerId: string,
        _credentialRevision: number,
        use: (credential: string | null) => Promise<T>,
      ) => use('scenario-key'),
    },
  );
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'explicit-live-model',
              owned_by: 'explicit-provider',
              nexus_capabilities: explicitMetadata,
            },
            {
              id: 'heuristic-only-model',
              owned_by: 'generic-compatible',
              context_length: 128_000,
              max_completion_tokens: 16_000,
              supported_parameters: ['tools', 'vision'],
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch;
    const adapterDiscovery = await adapter.discoverModels(1, adapterProvider.id, new AbortController().signal);
    assert.equal(adapterDiscovery[0]?.id, 'explicit-live-model');
    assert.deepEqual(adapterDiscovery[0]?.liveCapabilityReport, parsedExplicit);
    assert.equal(adapterDiscovery[1]?.id, 'heuristic-only-model');
    assert.equal(
      adapterDiscovery[1]?.liveCapabilityReport,
      undefined,
      'Generic context/parameter fields must remain non-authoritative without nexus_capabilities',
    );

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: [{ id: 'broken-live-model', nexus_capabilities: { schema_version: 1, supports_tools: 'yes' } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch;
    await assert.rejects(
      () => adapter.discoverModels(1, adapterProvider.id, new AbortController().signal),
      /PROVIDER_CAPABILITY_METADATA_INVALID/,
      'Malformed explicit provider capability metadata must fail discovery closed',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  const endpointDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-provider-live-endpoint-'));
  const endpointDb = new DatabaseAdapter({
    dataDirectory: endpointDirectory,
    filename: 'provider-live-endpoint.sqlite',
    nodeEnv: 'test',
  });
  try {
    await endpointDb.initialize();
    await endpointDb.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'provider-user', 'unused')");
    const endpointRepository = new SqliteProviderRepository(endpointDb, {
      encrypt: (value) => `opaque:${value}`,
      decrypt: (value) => (value.startsWith('opaque:') ? value.slice('opaque:'.length) : value),
    });
    const knownProvider = await endpointRepository.create({
      id: 'endpoint-known-provider',
      userId: 1,
      kind: 'openai-compatible',
      displayName: 'Endpoint known provider',
      baseUrl: 'https://old-provider.example/v1',
      protocol: 'chat-completions',
      models: [{ id: 'gpt-4o' }],
      enabled: true,
      createdAt: clock.nowUnixSeconds(),
      updatedAt: clock.nowUnixSeconds(),
    });
    await endpointRepository.replaceLiveCapabilities(1, knownProvider.id, [
      {
        modelId: 'gpt-4o',
        source: 'old-provider-live',
        sourceVersion: 'old-live-v1',
        capabilities: { maxOutputTokens: 8_192 },
        updatedAt: clock.nowUnixSeconds(),
      },
    ]);
    const endpointService = new ProviderService(endpointRepository, new ScriptedLanguageModel([]), clock);
    const knownBefore = await endpointService.get(1, knownProvider.id);
    assert.equal(knownBefore.models[0]?.maxOutputTokens, 8_192);
    assert.equal(knownBefore.models[0]?.capabilitySources.maxOutputTokens, 'provider');
    const knownAfter = await endpointService.update(1, knownProvider.id, knownProvider.version, {
      kind: knownBefore.kind,
      displayName: knownBefore.displayName,
      baseUrl: 'https://new-provider.example/v1',
      protocol: knownBefore.protocol,
      models: knownBefore.models,
      enabled: knownBefore.enabled,
    });
    assert.equal(knownAfter.version, knownProvider.version + 1);
    assert.equal(knownAfter.models[0]?.maxOutputTokens, 16_384);
    assert.equal(knownAfter.models[0]?.capabilitySources.maxOutputTokens, 'registry');
    assert.equal(knownAfter.models[0]?.capabilityOverrides?.maxOutputTokens, undefined);
    assert.deepEqual((await endpointRepository.get(1, knownProvider.id))?.liveCapabilities, []);

    const privateProvider = await endpointRepository.create({
      id: 'endpoint-private-provider',
      userId: 1,
      kind: 'openai-compatible',
      displayName: 'Endpoint private provider',
      baseUrl: 'https://old-private.example/v1',
      protocol: 'chat-completions',
      models: [{ id: 'private-endpoint-model' }],
      enabled: true,
      createdAt: clock.nowUnixSeconds(),
      updatedAt: clock.nowUnixSeconds(),
    });
    await endpointRepository.replaceLiveCapabilities(1, privateProvider.id, [
      {
        modelId: 'private-endpoint-model',
        source: 'old-private-live',
        sourceVersion: 'old-private-v1',
        capabilities: { contextWindow: 32_000, maxOutputTokens: 4_000, supportsTools: true },
        updatedAt: clock.nowUnixSeconds(),
      },
    ]);
    const privateBefore = await endpointService.get(1, privateProvider.id);
    await assert.rejects(
      () =>
        endpointService.update(1, privateProvider.id, privateProvider.version, {
          kind: privateBefore.kind,
          displayName: privateBefore.displayName,
          baseUrl: 'https://new-private.example/v1',
          protocol: privateBefore.protocol,
          models: privateBefore.models,
          enabled: privateBefore.enabled,
        }),
      /MODEL_CAPABILITY_INCOMPLETE/,
      'Changing Provider endpoint must fail closed when a private model is only complete because of old live metadata',
    );
    const privatePersisted = await endpointRepository.get(1, privateProvider.id);
    assert.equal(privatePersisted?.baseUrl, privateProvider.baseUrl);
    assert.equal(privatePersisted?.version, privateProvider.version);
    assert.equal(privatePersisted?.liveCapabilities[0]?.sourceVersion, 'old-private-v1');
  } finally {
    await endpointDb.close().catch(() => undefined);
    fs.rmSync(endpointDirectory, { recursive: true, force: true });
  }

  return [
    { name: 'source_precedence_levels', value: 3, unit: 'sources' },
    { name: 'field_merge_cases', value: 5, unit: 'cases' },
    { name: 'provider_refreshes_without_config_version_bump', value: 2, unit: 'refreshes' },
    { name: 'durable_run_snapshots_survive_refresh', value: 1, unit: 'snapshots' },
    { name: 'explicit_provider_metadata_ingestions', value: 1, unit: 'reports' },
    { name: 'heuristic_provider_metadata_inferences', value: 0, unit: 'reports' },
    { name: 'malformed_provider_metadata_fail_closed', value: 1, unit: 'cases' },
    { name: 'endpoint_change_live_observation_resets', value: 1, unit: 'resets' },
    { name: 'private_model_endpoint_change_fail_closed', value: 1, unit: 'cases' },
  ];
};

const browserTargetScopedRevisionScenario: Scenario = async () => {
  const cryptoHash = { sha256Utf8: (value: string) => createHash('sha256').update(value, 'utf8').digest('hex') };
  const runId = randomUUID();
  const agentRuntimeId = randomUUID();
  const sessionId = randomUUID();
  const workspaceId = randomUUID();
  const context: ToolContext = {
    userId: 1,
    appId: 'browser-target-revision-app',
    actor: { kind: 'agent', userId: 1, appId: 'browser-target-revision-app', runId, agentRuntimeId },
    runId,
    agentRuntimeId,
    connectionIds: [],
    environment: null,
    stepId: 'browser-target-revision-step',
    signal: new AbortController().signal,
    deadlineAt: Math.floor(Date.now() / 1000) + 120,
    maxOutputBytes: 65_536,
    inputRevision: 0,
  };
  const initialTarget = {
    id: 'target-scoped',
    endpoints: [
      {
        scope: 'external-network' as const,
        via: 'backend' as const,
        url: 'https://browser.example.test/',
        priority: 1,
        allowPlaintext: false,
        verifyTls: true,
      },
    ],
    allowedUrlPatterns: ['https://example.test/*'],
  };
  let configuredTarget = structuredClone(initialTarget);
  let targetAvailable = true;
  let settingsRevision = 7;
  const settings = {
    get: async () => ({
      revision: settingsRevision,
      effectiveSettings: {
        browser: { targets: targetAvailable ? [structuredClone(configuredTarget)] : [] },
      },
    }),
  };
  const workspace = {
    id: workspaceId,
    runId,
    agentRuntimeId,
    generation: 3,
    status: 'running',
    profile: {
      browserTarget: {
        id: 'workspace-frozen-target',
        profileRevision: 42,
        endpoints: [
          {
            scope: 'docker-network' as const,
            via: 'runner' as const,
            url: 'http://browser.internal:9222/',
            priority: 1,
            allowPlaintext: true,
            verifyTls: true,
          },
        ],
        allowedUrlPatterns: ['https://workspace.example.test/*'],
      },
    },
  };
  const repository = {
    getWorkspace: async (_scope: unknown, requestedWorkspaceId: string) =>
      requestedWorkspaceId === workspaceId ? workspace : null,
  };
  let session: import('../../../packages/backend/src/modules/agent/ai/integrations.types').BrowserSessionView | null =
    null;
  let closeCount = 0;
  const gateway = {
    createSession: async (
      request: import('../../../packages/backend/src/modules/agent/ai/integrations.types').BrowserSessionRequest,
    ) => {
      session = {
        userId: request.userId,
        appId: request.appId,
        runId: request.runId,
        agentRuntimeId: request.agentRuntimeId,
        sessionId,
        targetId: request.target.id,
        targetRevision: request.target.profileRevision,
        targetConfigurationHash: request.target.configurationHash,
        workspaceId: request.workspaceId ?? null,
        generation: request.generation ?? null,
        url: 'about:blank',
        createdAt: 1_800_000_000,
      };
      return session;
    },
    getSession: async () => {
      if (!session) throw new Error('BROWSER_SESSION_NOT_FOUND');
      return session;
    },
    close: async () => {
      closeCount += 1;
    },
  };
  const tools = createBrowserTools(repository as never, settings as never, gateway as never, cryptoHash);
  const createTool = tools.find((tool) => tool.descriptor.name === 'browser_create_session')!;
  const snapshotTool = tools.find((tool) => tool.descriptor.name === 'browser_snapshot')!;

  const createInspection = await createTool.inspect({ targetId: initialTarget.id }, context, 1);
  const initialNormalized = createInspection.normalizedArguments as Record<string, JsonValue>;
  settingsRevision = 8;
  const sameTargetInspection = await createTool.inspect({ targetId: initialTarget.id }, context, 1);
  const sameNormalized = sameTargetInspection.normalizedArguments as Record<string, JsonValue>;
  assert.equal(
    sameTargetInspection.operationHash,
    createInspection.operationHash,
    'unrelated Agent Settings revision changes must not alter Browser target operation identity',
  );
  assert.equal(sameNormalized.targetRevision, initialNormalized.targetRevision);
  assert.equal(sameNormalized.targetConfigurationHash, initialNormalized.targetConfigurationHash);

  await assert.doesNotReject(
    () => createTool.execute(createInspection, context),
    'P-107 requires unrelated Agent Settings revision changes to preserve a standalone Browser target identity',
  );
  await assert.doesNotReject(
    () => snapshotTool.inspect({ sessionId }, context, 1),
    'an existing standalone Browser session must survive an unrelated settings revision change',
  );
  assert.equal(closeCount, 0);

  settingsRevision = 9;
  configuredTarget = {
    ...configuredTarget,
    endpoints: [{ ...configuredTarget.endpoints[0]!, url: 'https://browser-changed.example.test/' }],
  };
  await assert.rejects(
    () => snapshotTool.inspect({ sessionId }, context, 1),
    /BROWSER_TARGET_STALE/,
    'changing the selected Browser target endpoint must stale the old standalone session',
  );
  assert.equal(closeCount, 1);

  const changedTargetInspection = await createTool.inspect({ targetId: initialTarget.id }, context, 1);
  await createTool.execute(changedTargetInspection, context);
  targetAvailable = false;
  settingsRevision = 10;
  await assert.rejects(
    () => snapshotTool.inspect({ sessionId }, context, 1),
    /BROWSER_TARGET_STALE/,
    'deleting the selected Browser target must close and stale the old standalone session',
  );
  assert.equal(closeCount, 2);

  const workspaceInspection = await createTool.inspect({ workspaceId }, context, 1);
  const workspaceNormalized = workspaceInspection.normalizedArguments as Record<string, JsonValue>;
  assert.equal(
    workspaceNormalized.targetRevision,
    42,
    'Workspace Browser target must keep its frozen profile revision',
  );
  await createTool.execute(workspaceInspection, context);
  settingsRevision = 11;
  await assert.doesNotReject(
    () => snapshotTool.inspect({ sessionId }, context, 1),
    'Workspace-bound Browser session must remain governed by frozen workspace target/generation, not global settings revision',
  );
  assert.equal(closeCount, 2);

  return [
    { name: 'browser_unrelated_settings_revision_survivals', value: 1, unit: 'sessions' },
    { name: 'browser_target_operation_identity_survivals', value: 1, unit: 'operations' },
    { name: 'browser_target_content_stale_rejections', value: 1, unit: 'sessions' },
    { name: 'browser_target_deletion_stale_rejections', value: 1, unit: 'sessions' },
    { name: 'browser_workspace_frozen_revision_preservations', value: 1, unit: 'sessions' },
    { name: 'browser_spurious_session_closes', value: 0, unit: 'sessions' },
  ];
};

const logErrorCodeSafetyScenario: Scenario = async () => {
  assert.equal(logErrorCode(new Error('STATE_CONFLICT'), 'SAFE_FALLBACK'), 'STATE_CONFLICT');
  assert.equal(
    logErrorCode(new Error('upstream response body contained credential material'), 'SAFE_FALLBACK'),
    'SAFE_FALLBACK',
  );
  assert.equal(
    logErrorCode(Object.assign(new Error('socket failed'), { code: 'ECONNRESET' }), 'SAFE_FALLBACK'),
    'ECONNRESET',
  );
  assert.equal(logErrorCode('opaque failure', 'not-safe'), 'UNEXPECTED_ERROR');
  return [{ name: 'log_error_code_safety_cases', value: 4, unit: 'cases' }];
};

const scenarios = new Map<string, Scenario>([
  ['context/tool-exchange-atomicity', contextToolExchangeScenario],
  ['context/durable-compaction-checkpoint', durableContextCheckpointScenario],
  ['migration/legacy-machine-inspection-targets', legacyMachineInspectionMigrationScenario],
  ['migration/capability-grants-v2', capabilityGrantMigrationScenario],
  ['context/token-accounting', contextTokenAccountingScenario],
  ['context/project-instructions', projectInstructionsContextScenario],
  ['workspace/coding-tool-surface', workspaceCodingToolSurfaceScenario],
  ['file/unified-targets', unifiedFileCapabilityScenario],
  ['shell/unified-targets', unifiedShellCapabilityScenario],
  ['workspace/repo-map-code-intel', workspaceRepoMapCodeIntelScenario],
  ['workspace/background-job-lifecycle', workspaceBackgroundJobLifecycleScenario],
  ['context/tool-result-projection', toolResultProjectionScenario],
  ['context/tool-surface-progressive-disclosure', toolSurfaceProgressiveDisclosureScenario],
  ['runtime/mcp-protocol-surface', mcpProtocolSurfaceScenario],
  ['runtime/mcp-input-required-durable-lifecycle', mcpInputRequiredDurableLifecycleScenario],
  ['provider/prompt-cache-hint', providerPromptCacheHintScenario],
  ['context/artifact-model-input', artifactModelInputScenario],
  ['context/skill-progressive-disclosure', skillProgressiveDisclosureScenario],
  ['context/indexed-recall', indexedRecallScenario],
  ['benchmark/scripted-agent-trajectories', scriptedAgentBenchmarkScenario],
  ['boundary/durable-runtime-decode', durableBoundaryDecodeScenario],
  ['boundary/current-durable-schema', currentDurableSchemaScenario],
  ['model/capability-registry-sync', modelCapabilityRegistrySyncScenario],
  ['model/provider-live-capability-authority', providerLiveCapabilityAuthorityScenario],
  ['model/stream-retry-attempt-identity', modelStreamRetryAttemptIdentityScenario],
  ['runtime/agent-lifecycle-notifications', agentLifecycleNotificationScenario],
  ['model/plan-execution-mode', planExecutionModeScenario],
  ['runtime/default-policy-authority', defaultPolicyAuthorityScenario],
  ['runtime/log-error-code-safety', logErrorCodeSafetyScenario],
  ['runtime/budget-settings-dead-fields', budgetSettingsDeadFieldScenario],
  ['model/provider-settings-dead-field', providerSettingsDeadFieldScenario],
  ['model/provider-fallback-chain', providerFallbackChainScenario],
  ['model/agent-definition-capability-contract', agentDefinitionCapabilityContractScenario],
  ['model/completion-gate', completionGateScenario],
  ['model/finish-reason-state-machine', modelFinishReasonStateMachineScenario],
  ['model/provider-continuation-roundtrip', providerContinuationRoundTripScenario],
  ['runtime/user-input-clarification', userInputClarificationScenario],
  ['runtime/restart-recovery-closure', restartRecoveryScenario],
  ['runtime/app-disable-scope-closure', appDisableScopeScenario],
  ['runtime/read-tool-batch-authority', readToolBatchAuthorityScenario],
  ['runtime/subagent-claimed-cancellation', subagentClaimedCancellationScenario],
  ['runtime/subagent-fail-fast-cancellation', failFastSiblingCancellationScenario],
  ['runtime/nested-join-durable-wake', nestedJoinDurableWakeScenario],
  ['runtime/subagent-mailbox-ttl', subagentMailboxTtlScenario],
  ['runtime/subagent-profile-strategy', subagentProfileStrategyScenario],
  ['runtime/subagent-governed-mutation', subagentGovernedMutationScenario],
  ['runtime/confirmed-mutation-lease-finalization', confirmedMutationLeaseFinalizationScenario],
  ['runtime/mutation-output-projection', mutationOutputProjectionScenario],
  ['storage/artifact-lifecycle-settings', artifactLifecycleSettingsScenario],
  ['recovery/checkpoint-workspace-evidence', checkpointWorkspaceEvidenceScenario],
  ['runtime/artifact-crash-reconciliation', artifactCrashReconciliationScenario],
  ['runtime/integration-cas-before-runtime', integrationCasBeforeRuntimeScenario],
  ['runtime/integration-refresh-generation', integrationRefreshGenerationScenario],
  ['runtime/integration-health-retry', integrationHealthRetryScenario],
  ['runtime/acp-inner-permission', acpInnerPermissionScenario],
  ['runtime/acp-inner-permission-abort-race', acpInnerPermissionAbortRaceScenario],
  ['runtime/acp-inner-permission-replay', acpInnerPermissionReplayScenario],
  ['runtime/acp-inner-permission-durable', acpInnerPermissionDurabilityScenario],
  ['runtime/idempotency-ttl', idempotencyTtlScenario],
  ['runtime/model-aware-context-budget', modelAwareContextBudgetScenario],
  ['runtime/cumulative-token-ceiling-removed', cumulativeTokenCeilingRemovedScenario],
  ['runtime/progress-aware-loop-guard', progressAwareLoopGuardScenario],
  ['http/public-agent-error-taxonomy', publicAgentErrorTaxonomyScenario],
  ['runtime/plugin-app-intent-sdk', pluginAppIntentSdkScenario],
  ['runtime/memory-product-closure', memoryProductClosureScenario],
  ['workspace/suspended-session-ownership', suspendedSessionOwnershipScenario],
  ['browser/target-scoped-revision', browserTargetScopedRevisionScenario],
  ['browser/interaction-primitives', browserInteractionPrimitivesScenario],
  ['browser/screenshot-artifact-vision', browserScreenshotVisionScenario],
  ['machine/route-dependency-approval', machineRouteDependencyApprovalScenario],
  ['runtime/artifact-single-delete-product', artifactSingleDeleteProductScenario],
]);

const SERIAL_SCENARIOS = new Set([
  'workspace/coding-tool-surface',
  'provider/prompt-cache-hint',
  'model/capability-registry-sync',
  'model/provider-live-capability-authority',
]);

const SCENARIO_CONCURRENCY = 4;

interface ScenarioOutcome {
  result: ScenarioResult | null;
  failure: { name: string; error: unknown } | null;
}

const executeScenario = async ([name, run]: [string, Scenario]): Promise<ScenarioOutcome> => {
  const started = performance.now();
  try {
    const metrics = await run();
    return {
      result: { name, durationMs: performance.now() - started, metrics },
      failure: null,
    };
  } catch (error) {
    return {
      result: null,
      failure: { name, error },
    };
  }
};

const main = async (): Promise<void> => {
  const results: ScenarioResult[] = [];
  const failures: Array<{ name: string; error: unknown }> = [];

  const recordOutcome = (outcome: ScenarioOutcome): void => {
    if (outcome.result) {
      results.push(outcome.result);
      console.log(`PASS ${outcome.result.name}`);
      return;
    }
    if (outcome.failure) {
      failures.push(outcome.failure);
      console.error(`FAIL ${outcome.failure.name}`);
    }
  };

  const runConcurrentBatch = async (entries: Array<[string, Scenario]>): Promise<void> => {
    for (let index = 0; index < entries.length; index += SCENARIO_CONCURRENCY) {
      const outcomes = await Promise.all(entries.slice(index, index + SCENARIO_CONCURRENCY).map(executeScenario));
      for (const outcome of outcomes) recordOutcome(outcome);
    }
  };

  let concurrentBatch: Array<[string, Scenario]> = [];
  for (const entry of scenarios.entries()) {
    if (!SERIAL_SCENARIOS.has(entry[0])) {
      concurrentBatch.push(entry);
      continue;
    }

    await runConcurrentBatch(concurrentBatch);
    concurrentBatch = [];
    recordOutcome(await executeScenario(entry));
  }
  await runConcurrentBatch(concurrentBatch);

  console.log(
    JSON.stringify(
      {
        schemaVersion: 1,
        scenarios: results.map((result) => ({
          ...result,
          durationMs: Math.round(result.durationMs * 100) / 100,
        })),
      },
      null,
      2,
    ),
  );

  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAILURE ${failure.name}`, failure.error);
    throw new AggregateError(
      failures.map((failure) => failure.error),
      `${failures.length} Agent scenario(s) failed`,
    );
  }
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
