import { randomUUID } from 'node:crypto';
import type { ClockPort, JsonValue, Scope } from '../../agent.types';
import type { ProviderService } from '../../ai/provider.service';
import type { AgentSettingsService } from '../../host/agent-settings.service';
import type { AppLifecycleService } from '../../host/app-lifecycle.service';
import type { TargetDenylistRepositoryPort } from '../../host/target-denylist.repository.port';
import { isAgentUuid } from '../../uuid';
import type { AgentDefinitionRegistryPort } from '../definitions/agent-definition.port';
import type { CheckpointRepositoryPort, CheckpointView } from './checkpoint.repository.port';
import { requestHash, requireIdempotencyKey } from '../runs/idempotency';
import type { RunSnapshotReaderPort } from '../runs/run.repository.port';
import type { RunCreationCommitPort } from '../runs/state-commit.port';
import { TERMINAL_RUN_STATUSES, type RunBudget, type RunDefinitionSnapshot, type RunView } from '../runs/run.types';

const clampBudget = (
  source: RunBudget,
  settings: Awaited<ReturnType<AgentSettingsService['get']>>,
  model: { contextWindow: number; maxOutputTokens: number },
): RunBudget => {
  const hard = settings.hardLimits;
  const effective = settings.effectiveSettings.budget;
  const maxRunCostMicros =
    source.maxRunCostMicros === null
      ? hard.maxRunCostMicros
      : hard.maxRunCostMicros === null
        ? source.maxRunCostMicros
        : Math.min(source.maxRunCostMicros, hard.maxRunCostMicros);
  const maxContextTokens = Math.max(
    2,
    Math.min(source.maxContextTokens, effective.maxContextTokens, hard.maxContextTokens, model.contextWindow),
  );
  return {
    maxContextTokens,
    maxOutputTokens: Math.max(
      1,
      Math.min(
        source.maxOutputTokens,
        effective.maxOutputTokens,
        hard.maxOutputTokens,
        model.maxOutputTokens,
        maxContextTokens - 1,
      ),
    ),
    maxRunTokens: Math.min(source.maxRunTokens, hard.maxRunTokens),
    maxRunSteps: Math.min(source.maxRunSteps, hard.maxRunSteps),
    maxRunCostMicros,
    maxActiveExecutionSeconds: Math.min(source.maxActiveExecutionSeconds, hard.maxActiveExecutionSeconds),
    toolTimeoutSeconds: Math.min(source.toolTimeoutSeconds, hard.toolTimeoutSeconds),
    maxToolOutputBytes: Math.min(source.maxToolOutputBytes, hard.maxToolOutputBytes),
    maxRawToolBytes: Math.min(source.maxRawToolBytes, hard.maxRawToolBytes),
    maxRecallItems: Math.min(source.maxRecallItems, hard.maxRecallItems),
    maxRecallBytes: Math.min(source.maxRecallBytes, hard.maxRecallBytes),
    maxSubagentMessages: Math.min(source.maxSubagentMessages, hard.maxSubagentMessagesPerRun),
    maxSubagentMessageBytes: Math.min(source.maxSubagentMessageBytes, hard.maxSubagentMessageBytesPerRun),
    revision: settings.revision,
  };
};

export interface CheckpointValidation {
  valid: boolean;
  reasons: string[];
  checkpoint: CheckpointView | null;
}

const checkpointRecoveryReasons = (checkpoint: CheckpointView): string[] => {
  const manifest = checkpoint.snapshot.recoveryManifest;
  if (!manifest) return ['CHECKPOINT_RECOVERY_MANIFEST_MISSING'];
  const reasons: string[] = [];
  if (
    checkpoint.snapshot.runId !== checkpoint.runId ||
    checkpoint.snapshot.ledgerThrough !== checkpoint.ledgerThrough ||
    manifest.schemaVersion !== 1 ||
    manifest.eventThrough !== checkpoint.eventThrough ||
    !Number.isSafeInteger(manifest.contextBoundary.baseThrough) ||
    manifest.contextBoundary.baseThrough < 0 ||
    Object.keys(manifest.contextBoundary.runThrough).length > 64 ||
    Object.values(manifest.contextBoundary.runThrough).some((through) => !Number.isSafeInteger(through) || through < 0)
  ) {
    reasons.push('CHECKPOINT_INVALID');
  }
  if (
    manifest.quarantinedResourceKeys.length > 0 ||
    manifest.tools.some((tool) => tool.sideEffectStatus === 'unknown' || tool.quarantinedResourceKeys.length > 0) ||
    manifest.delegations.some((delegation) => ['queued', 'running', 'waiting'].includes(delegation.status))
  ) {
    reasons.push('CHECKPOINT_NOT_SAFE');
  }
  return reasons;
};

export class CheckpointService {
  constructor(
    private readonly checkpoints: CheckpointRepositoryPort,
    private readonly runs: RunSnapshotReaderPort,
    private readonly settings: AgentSettingsService,
    private readonly lifecycle: AppLifecycleService,
    private readonly providers: ProviderService,
    private readonly definitions: AgentDefinitionRegistryPort,
    private readonly denylist: TargetDenylistRepositoryPort,
    private readonly stateCommit: RunCreationCommitPort,
    private readonly clock: ClockPort,
    private readonly onCreated: (run: RunView) => void = () => undefined,
    private readonly onCommitted: (run: RunView) => void = () => undefined,
  ) {}

  async save(scope: Scope, runId: string, expectedVersion: number): Promise<CheckpointView> {
    if (!isAgentUuid(runId) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new Error('VALIDATION_FAILED');
    }
    const run = await this.runs.snapshot(scope, runId);
    if (!run) throw new Error('NOT_FOUND');
    const definition = this.definitions.require(scope.appId, run.definition.agentDefinitionId);
    return this.checkpoints.save({
      scope,
      checkpointId: randomUUID(),
      runId,
      expectedRunVersion: expectedVersion,
      definitionVersion: definition.version,
      now: this.clock.nowUnixSeconds(),
    });
  }

  async list(scope: Scope, runId: string): Promise<CheckpointView[]> {
    if (!isAgentUuid(runId)) throw new Error('VALIDATION_FAILED');
    return this.checkpoints.list(scope, runId, 50);
  }

  async validate(
    scope: Scope,
    runId: string,
    checkpointId: string,
    expectedVersion: number,
  ): Promise<CheckpointValidation> {
    const reasons: string[] = [];
    if (
      !isAgentUuid(runId) ||
      !isAgentUuid(checkpointId) ||
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 1
    ) {
      throw new Error('VALIDATION_FAILED');
    }
    const [run, checkpoint] = await Promise.all([
      this.runs.snapshot(scope, runId),
      this.checkpoints.get(scope, checkpointId),
    ]);
    if (!run || !checkpoint || checkpoint.runId !== runId)
      return { valid: false, reasons: ['CHECKPOINT_NOT_FOUND'], checkpoint };
    reasons.push(...checkpointRecoveryReasons(checkpoint));
    if (run.version !== expectedVersion) reasons.push('STATE_CONFLICT');
    if (!TERMINAL_RUN_STATUSES.has(run.status)) reasons.push('RUN_RESUME_SOURCE_NOT_TERMINAL');
    if (run.needsReconciliation) reasons.push('RECONCILIATION_REQUIRED');
    const definition = this.definitions.require(scope.appId, run.definition.agentDefinitionId);
    if (definition.version !== checkpoint.snapshot.definitionVersion) reasons.push('CHECKPOINT_DEFINITION_STALE');
    let provider = null;
    try {
      provider = await this.providers.get(scope.userId, run.definition.model.providerId);
    } catch {
      reasons.push('CHECKPOINT_PROVIDER_UNAVAILABLE');
    }
    if (provider) {
      if (!provider.enabled || provider.version !== checkpoint.snapshot.modelConfigurationVersion) {
        reasons.push('CHECKPOINT_PROVIDER_STALE');
      } else if (!provider.models.some((model) => model.id === run.definition.model.modelId)) {
        reasons.push('CHECKPOINT_MODEL_UNAVAILABLE');
      }
    }
    for (const connectionId of run.definition.connectionIds) {
      if (await this.denylist.isDenied(connectionId)) {
        reasons.push('CHECKPOINT_TARGET_DENIED');
        break;
      }
    }
    const [missingArtifactRefs, recoveryHazards] = await Promise.all([
      this.checkpoints.missingArtifactRefs(scope, checkpointId),
      this.checkpoints.recoveryHazards(scope, checkpointId),
    ]);
    if (missingArtifactRefs.length) reasons.push('CHECKPOINT_ARTIFACT_UNAVAILABLE');
    if (
      recoveryHazards.postCheckpointMutationToolCallIds.length > 0 ||
      recoveryHazards.quarantinedResourceKeys.length > 0
    ) {
      reasons.push('CHECKPOINT_SIDE_EFFECT_DIVERGED');
    }
    return { valid: reasons.length === 0, reasons: [...new Set(reasons)], checkpoint };
  }

  async resume(
    scope: Scope,
    runId: string,
    checkpointId: string,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<RunView> {
    const key = requireIdempotencyKey(idempotencyKey);
    const validation = await this.validate(scope, runId, checkpointId, expectedVersion);
    if (!validation.valid || !validation.checkpoint) throw new Error(validation.reasons[0] ?? 'CHECKPOINT_INVALID');
    const source = await this.runs.snapshot(scope, runId);
    if (!source) throw new Error('NOT_FOUND');
    const recoveryManifest = validation.checkpoint.snapshot.recoveryManifest;
    if (!recoveryManifest) throw new Error('CHECKPOINT_RECOVERY_MANIFEST_MISSING');
    const [settings, app, provider] = await Promise.all([
      this.settings.get(scope.userId),
      this.lifecycle.get(scope),
      this.providers.get(scope.userId, source.definition.model.providerId),
    ]);
    if (!settings.effectiveSettings.feature.enabled) throw new Error('AGENT_DISABLED');
    if (app.desiredState !== 'enabled' || !['running', 'degraded'].includes(app.observedState))
      throw new Error('AGENT_APP_DISABLED');
    if (!app.acceptNewRuns) throw new Error('AGENT_APP_DRAINING');
    if (!provider.enabled || provider.version !== validation.checkpoint.snapshot.modelConfigurationVersion) {
      throw new Error('CHECKPOINT_PROVIDER_STALE');
    }
    const model = provider.models.find((candidate) => candidate.id === source.definition.model.modelId);
    if (!model) throw new Error('CHECKPOINT_MODEL_UNAVAILABLE');
    const definitionInfo = this.definitions.require(scope.appId, source.definition.agentDefinitionId);
    if (definitionInfo.version !== validation.checkpoint.snapshot.definitionVersion) {
      throw new Error('CHECKPOINT_DEFINITION_STALE');
    }
    const budget = clampBudget(source.budget, settings, model);
    if (
      budget.maxRunCostMicros !== null &&
      (model.priceMicrosPerMillionInput === undefined || model.priceMicrosPerMillionOutput === undefined)
    ) {
      throw new Error('MODEL_PRICE_UNKNOWN');
    }
    const definition: RunDefinitionSnapshot = {
      ...source.definition,
      policyRevision: app.policyRevision,
      settingsRevision: settings.revision,
      contextBoundary: {
        baseThrough: recoveryManifest.contextBoundary.baseThrough,
        runThrough: { ...recoveryManifest.contextBoundary.runThrough },
      },
    };
    const refs = [
      ...new Set([
        ...validation.checkpoint.snapshot.evidenceRefs,
        ...validation.checkpoint.snapshot.workspaceArtifactManifestRefs,
      ]),
    ];
    const request: JsonValue = {
      sourceRunId: runId,
      checkpointId,
      expectedVersion,
      checkpointCreatedAt: validation.checkpoint.createdAt,
      contextBoundary: {
        baseThrough: recoveryManifest.contextBoundary.baseThrough,
        runThrough: { ...recoveryManifest.contextBoundary.runThrough },
      },
    };
    const committed = await this.stateCommit.createRun({
      scope,
      runId: randomUUID(),
      runtimeId: randomUUID(),
      threadId: source.threadId,
      inputEntryId: randomUUID(),
      input: { text: '', artifactRefs: refs },
      parentRunId: source.id,
      initialEntry: {
        kind: 'system_notice',
        payload: {
          type: 'checkpoint.resume',
          sourceRunId: source.id,
          checkpointId,
          ledgerThrough: validation.checkpoint.ledgerThrough,
          eventThrough: validation.checkpoint.eventThrough,
          contextBoundary: {
            baseThrough: recoveryManifest.contextBoundary.baseThrough,
            runThrough: { ...recoveryManifest.contextBoundary.runThrough },
          },
        },
        artifactRefs: refs,
      },
      initialPlan: validation.checkpoint.snapshot.plan,
      agentDefinitionId: source.definition.agentDefinitionId,
      model: source.definition.model,
      connectionIds: [...source.definition.connectionIds],
      budget,
      definition,
      expectedPolicyRevision: app.policyRevision,
      idempotencyKey: key,
      requestHash: requestHash(1, request),
      requestId: randomUUID(),
      now: this.clock.nowUnixSeconds(),
    });
    await this.checkpoints.supersedeUnconsumedApprovals(scope, source.id, this.clock.nowUnixSeconds());
    if (!committed.replayed) {
      this.onCommitted(committed.run);
      this.onCreated(committed.run);
    }
    return committed.run;
  }
}
