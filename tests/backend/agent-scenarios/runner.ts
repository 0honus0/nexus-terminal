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
import { SqliteAgentSettingsRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-agent-settings.repository';
import { SqliteConversationRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-conversation.repository';
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
import { decodeOpenAiResponsesContinuation } from '../../../packages/backend/src/infrastructure/agent/providers/openai-provider-continuation';
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
import { TOOL_APPROVAL_TTL_SECONDS } from '../../../packages/backend/src/modules/agent/runtime/approvals/approval-policy';
import { ApprovalService } from '../../../packages/backend/src/modules/agent/runtime/approvals/approval.service';
import { AcpPermissionBroker } from '../../../packages/backend/src/modules/agent/runtime/approvals/acp-permission-broker';
import { toolLeaseTtlSeconds } from '../../../packages/backend/src/modules/agent/runtime/execution/tool-lease-policy';
import { ContextService } from '../../../packages/backend/src/modules/agent/ai/context.service';
import type { IntegrationRepositoryPort } from '../../../packages/backend/src/modules/agent/ai/integration.repository.port';
import type {
  AcpRuntimePort,
  IntegrationView,
} from '../../../packages/backend/src/modules/agent/ai/integrations.types';
import { createAcpExecuteTool } from '../../../packages/backend/src/modules/agent/tools/host/acp-tools';
import type { LanguageModelPort } from '../../../packages/backend/src/modules/agent/ai/language-model.port';
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
import { SkillRegistry } from '../../../packages/backend/src/modules/agent/ai/skill-registry';
import type { BackendSignal } from '../../../packages/backend/src/modules/agent/runtime/execution/agent-backend.port';
import { completionGateDecision } from '../../../packages/backend/src/modules/agent/runtime/execution/completion-gate';
import { ModelCallLimiter } from '../../../packages/backend/src/modules/agent/runtime/execution/model-call-limiter';
import { ModelStepRunner } from '../../../packages/backend/src/modules/agent/runtime/execution/model-step-runner';
import { NativeAgentBackend } from '../../../packages/backend/src/modules/agent/runtime/execution/native-agent-backend';
import type { MutationLeaseGuardHandle } from '../../../packages/backend/src/modules/agent/runtime/execution/mutation-lease-guard.port';
import { ToolCallRunner } from '../../../packages/backend/src/modules/agent/runtime/execution/tool-call-runner';
import { createRequestUserInputTool } from '../../../packages/backend/src/modules/agent/tools/host/user-input-tools';
import { createPlanUpdateTool } from '../../../packages/backend/src/modules/agent/runtime/planning/plan-tool';
import { SubagentContextBuilder } from '../../../packages/backend/src/modules/agent/runtime/collaboration/subagent-context-builder';
import { SubagentCompletionCoordinator } from '../../../packages/backend/src/modules/agent/runtime/collaboration/subagent-completion-coordinator';
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
import type { RunSnapshot, RunView } from '../../../packages/backend/src/modules/agent/runtime/runs/run.types';
import { runModelRoutes } from '../../../packages/backend/src/modules/agent/runtime/runs/model-routes';
import { agentRoute } from '../../../packages/backend/src/interfaces/http/agent/agent-http';
import { parseCreateRunRequest } from '../../../packages/backend/src/interfaces/http/agent/agent-runtime-route-input';
import { artifactSingleDeleteProductScenario } from './artifact-single-delete-product.scenario';
import { memoryProductClosureScenario } from './memory-product-closure.scenario';
import { pluginAppIntentSdkScenario } from './plugin-app-intent-sdk.scenario';
import { providerPromptCacheHintScenario } from './provider-prompt-cache-hint.scenario';
import { clock, emptyModelContinuations, SCENARIO_MODEL_CAPABILITIES, scope } from './scenario-fixtures';
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
import { contextTokenAccountingScenario } from './context-token-accounting.scenario';
import { providerContinuationRoundTripScenario } from './provider-continuation-roundtrip.scenario';
import { durableContextCheckpointScenario } from './durable-context-checkpoint.scenario';
import { subagentProfileStrategyScenario } from './subagent-profile-strategy.scenario';
import { skillProgressiveDisclosureScenario } from './skill-progressive-disclosure.scenario';
import { artifactModelInputScenario } from './artifact-model-input.scenario';
import { contextToolExchangeScenario } from './context-tool-exchange.scenario';
import { readToolBatchAuthorityScenario } from './read-tool-batch-authority.scenario';
import { capabilityGrantMigrationScenario } from './capability-grant-migration.scenario';
import { integrationRefreshGenerationScenario } from './integration-refresh-generation.scenario';
import { artifactCrashReconciliationScenario } from './artifact-crash-reconciliation.scenario';
import { artifactLifecycleSettingsScenario } from './artifact-lifecycle-settings.scenario';
import { indexedRecallScenario } from './indexed-recall.scenario';
import { integrationCasBeforeRuntimeScenario } from './integration-cas-before-runtime.scenario';
import { budgetSettingsDeadFieldScenario } from './budget-settings-dead-field.scenario';
import { modelFinishReasonStateMachineScenario } from './model-finish-reason-state-machine.scenario';
import { browserTargetScopedRevisionScenario } from './browser-target-scoped-revision.scenario';
import { cumulativeTokenCeilingRemovedScenario } from './cumulative-token-ceiling-removed.scenario';

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
