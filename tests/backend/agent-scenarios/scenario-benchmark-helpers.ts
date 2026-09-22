import assert from 'node:assert/strict';
import type { Scope } from '../../../packages/backend/src/modules/agent/agent.types';
import type { AgentTool } from '../../../packages/backend/src/modules/agent/capabilities/tool.types';
import type { LanguageModelPort } from '../../../packages/backend/src/modules/agent/ai/language-model.port';
import type {
  DiscoveredProviderModel,
  ModelEvent,
  ModelRequest,
  PersistedProviderView,
  ProviderModelCapabilityObservation,
  TokenUsage,
} from '../../../packages/backend/src/modules/agent/ai/model.types';
import type {
  ProviderCreateRecord,
  ProviderRepositoryPort,
  ProviderUpdateRecord,
} from '../../../packages/backend/src/modules/agent/ai/provider.repository.port';
import type { BackendSignal } from '../../../packages/backend/src/modules/agent/runtime/execution/agent-backend.port';
import { ModelCallLimiter } from '../../../packages/backend/src/modules/agent/runtime/execution/model-call-limiter';
import { freezeRunContextPolicy } from '../../../packages/backend/src/modules/agent/runtime/runs/run-budget-policy';
import type { RunSnapshot } from '../../../packages/backend/src/modules/agent/runtime/runs/run.types';
import { SCENARIO_MODEL_CAPABILITIES } from './scenario-fixtures';

export class StaticProviderRepository implements ProviderRepositoryPort {
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

export class StaticProviderCatalogRepository implements ProviderRepositoryPort {
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

export class ScriptedLanguageModel implements LanguageModelPort {
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

export class ScenarioModelCallLimiter extends ModelCallLimiter {
  constructor() {
    super(null!);
  }

  override async acquire(_userId: number, signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) throw signal.reason ?? new Error('ABORTED');
    return () => undefined;
  }
}

export interface AgentBenchmarkCase {
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

export const benchmarkProvider: PersistedProviderView = {
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

export const drainGenerator = async <T>(generator: AsyncGenerator<unknown, T, void>): Promise<T> => {
  while (true) {
    const next = await generator.next();
    if (next.done) return next.value;
  }
};

export const collectBackendSignals = async <T>(
  generator: AsyncGenerator<BackendSignal, T, void>,
): Promise<{ signals: BackendSignal[]; result: T }> => {
  const signals: BackendSignal[] = [];
  while (true) {
    const next = await generator.next();
    if (next.done) return { signals, result: next.value };
    signals.push(next.value);
  }
};

export const benchmarkSnapshot = (benchmark: AgentBenchmarkCase, benchmarkScope: Scope): RunSnapshot => {
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
