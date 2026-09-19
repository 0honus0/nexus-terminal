import { randomUUID } from 'node:crypto';
import type { ClockPort, JsonValue, Scope } from '../../agent.types';
import { snapshotProviderModelCapabilities } from '../../ai/model-capability-resolver';
import { missingRequiredModelCapabilities } from '../../ai/model-capability-requirements';
import type { ProviderService } from '../../ai/provider.service';
import type { AgentSettingsService } from '../../host/agent-settings.service';
import type { AppLifecycleService } from '../../host/app-lifecycle.service';
import type { TargetDenylistRepositoryPort } from '../../host/target-denylist.repository.port';
import { isAgentUuid } from '../../uuid';
import type { AgentDefinitionRegistryPort } from '../definitions/agent-definition.port';
import type { CheckpointRepositoryPort, CheckpointView } from './checkpoint.repository.port';
import type { WorkspaceCheckpointService } from './workspace-checkpoint.service';
import { requestHash, requireIdempotencyKey } from '../runs/idempotency';
import type { RunExecutionReaderPort, RunSnapshotReaderPort } from '../runs/run.repository.port';
import type { CheckpointRecoveryCommitPort } from '../runs/state-commit.port';
import { TERMINAL_RUN_STATUSES, type RunBudget, type RunDefinitionSnapshot, type RunView } from '../runs/run.types';

const clampBudget = (
  source: RunBudget,
  settings: Awaited<ReturnType<AgentSettingsService['get']>>,
  model: { contextWindow: number; maxOutputTokens: number },
): RunBudget => {
  const hard = settings.hardLimits;
  const maxContextTokens = Math.max(2, model.contextWindow);
  return {
    maxContextTokens,
    maxOutputTokens: Math.max(1, Math.min(model.maxOutputTokens, maxContextTokens - 1)),
    maxRunSteps: Math.min(source.maxRunSteps, hard.maxRunSteps),
    maxActiveExecutionSeconds: Math.min(source.maxActiveExecutionSeconds, hard.maxActiveExecutionSeconds),
    toolTimeoutSeconds: Math.min(source.toolTimeoutSeconds, hard.toolTimeoutSeconds),
    maxToolOutputBytes: Math.min(source.maxToolOutputBytes, hard.maxToolOutputBytes),
    maxRecallItems: Math.min(source.maxRecallItems, hard.maxRecallItems),
    maxRecallBytes: Math.min(source.maxRecallBytes, hard.maxRecallBytes),
    maxSubagentMessages: Math.min(source.maxSubagentMessages, hard.maxSubagentMessagesPerRun),
    maxSubagentMessageBytes: Math.min(source.maxSubagentMessageBytes, hard.maxSubagentMessageBytesPerRun),
    contextCompactionMode: source.contextCompactionMode ?? 'balanced',
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
    private readonly runs: RunSnapshotReaderPort & Pick<RunExecutionReaderPort, 'rootRuntimeId'>,
    private readonly settings: AgentSettingsService,
    private readonly lifecycle: AppLifecycleService,
    private readonly providers: ProviderService,
    private readonly definitions: AgentDefinitionRegistryPort,
    private readonly denylist: TargetDenylistRepositoryPort,
    private readonly stateCommit: CheckpointRecoveryCommitPort,
    private readonly clock: ClockPort,
    private readonly onCreated: (run: RunView) => void = () => undefined,
    private readonly onCommitted: (run: RunView) => void = () => undefined,
    private readonly workspaceCheckpoints: WorkspaceCheckpointService | null = null,
  ) {}

  async save(scope: Scope, runId: string, expectedVersion: number): Promise<CheckpointView> {
    if (!isAgentUuid(runId) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new Error('VALIDATION_FAILED');
    }
    const run = await this.runs.snapshot(scope, runId);
    if (!run) throw new Error('NOT_FOUND');
    if (run.version !== expectedVersion) throw new Error('STATE_CONFLICT');
    const app = await this.lifecycle.get(scope);
    const definition = this.definitions.require(scope.appId, app.activeVersion, run.definition.agentDefinitionId);
    const workspaceCaptures = this.workspaceCheckpoints ? await this.workspaceCheckpoints.capture(scope, run.id) : [];
    return this.checkpoints.save({
      scope,
      checkpointId: randomUUID(),
      runId,
      expectedRunVersion: expectedVersion,
      definitionVersion: definition.version,
      workspaceCaptures,
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
    const app = await this.lifecycle.get(scope);
    const definition = this.definitions.require(scope.appId, app.activeVersion, run.definition.agentDefinitionId);
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
      } else {
        const model = provider.models.find((candidate) => candidate.id === run.definition.model.modelId);
        if (!model) {
          reasons.push('CHECKPOINT_MODEL_UNAVAILABLE');
        } else {
          const requirements = run.definition.requiredModelCapabilities ?? definition.requiredModelCapabilities;
          const capabilities = run.definition.modelCapabilities ?? snapshotProviderModelCapabilities(model);
          if (missingRequiredModelCapabilities(requirements, capabilities).length > 0) {
            reasons.push('CHECKPOINT_MODEL_CAPABILITY_UNSUPPORTED');
          }
        }
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
    if (checkpoint.snapshot.workspaceArtifactManifestRefs.length > 0) {
      if (!this.workspaceCheckpoints) {
        reasons.push('CHECKPOINT_WORKSPACE_MANIFEST_INVALID');
      } else {
        try {
          await this.workspaceCheckpoints.validate(
            scope,
            runId,
            run.definition.environment,
            checkpoint.snapshot.workspaceArtifactManifestRefs,
          );
        } catch {
          reasons.push('CHECKPOINT_WORKSPACE_MANIFEST_INVALID');
        }
      }
    }
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
    const definitionInfo = this.definitions.require(
      scope.appId,
      app.activeVersion,
      source.definition.agentDefinitionId,
    );
    if (definitionInfo.version !== validation.checkpoint.snapshot.definitionVersion) {
      throw new Error('CHECKPOINT_DEFINITION_STALE');
    }
    const requirements = source.definition.requiredModelCapabilities ?? definitionInfo.requiredModelCapabilities;
    const capabilities = source.definition.modelCapabilities ?? snapshotProviderModelCapabilities(model);
    if (missingRequiredModelCapabilities(requirements, capabilities).length > 0) {
      throw new Error('CHECKPOINT_MODEL_CAPABILITY_UNSUPPORTED');
    }
    const budget = clampBudget(source.budget, settings, model);
    const workspaceManifests =
      validation.checkpoint.snapshot.workspaceArtifactManifestRefs.length === 0
        ? []
        : this.workspaceCheckpoints
          ? await this.workspaceCheckpoints.validate(
              scope,
              source.id,
              source.definition.environment,
              validation.checkpoint.snapshot.workspaceArtifactManifestRefs,
            )
          : (() => {
              throw new Error('CHECKPOINT_WORKSPACE_MANIFEST_INVALID');
            })();
    const definition: RunDefinitionSnapshot = {
      ...source.definition,
      requiredModelCapabilities: [...requirements],
      modelCapabilities: capabilities,
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
      initialGoal: validation.checkpoint.snapshot.goal ?? source.goal,
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
    if (workspaceManifests.length > 0) {
      if (!this.workspaceCheckpoints) throw new Error('CHECKPOINT_WORKSPACE_MANIFEST_INVALID');
      const resumedRuntimeId = await this.runs.rootRuntimeId(scope, committed.run.id);
      await this.workspaceCheckpoints.restore(scope, committed.run.id, resumedRuntimeId, workspaceManifests);
    }
    await this.stateCommit.supersedeRunApprovals(scope, source.id, this.clock.nowUnixSeconds());
    if (!committed.replayed) {
      this.onCommitted(committed.run);
      this.onCreated(committed.run);
    }
    return committed.run;
  }
}
