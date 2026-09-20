import { randomUUID } from 'node:crypto';
import { logger } from '../../../../shared/logging/logger';
import type { ClockPort, JsonValue, Scope } from '../../agent.types';
import { missingRequiredModelCapabilities } from '../../ai/model-capability-requirements';
import type { ProviderService } from '../../ai/provider.service';
import type { AgentSettingsService } from '../../host/agent-settings.service';
import type { AppLifecycleService } from '../../host/app-lifecycle.service';
import type { TargetDenylistRepositoryPort } from '../../host/target-denylist.repository.port';
import { isAgentUuid } from '../../uuid';
import type { AgentDefinitionRegistryPort } from '../definitions/agent-definition.port';
import type {
  CheckpointBackgroundJobEntry,
  CheckpointKind,
  CheckpointRepositoryPort,
  CheckpointView,
} from './checkpoint.repository.port';
import type { WorkspaceCheckpointService } from './workspace-checkpoint.service';
import type { WorkspaceRuntimeGatewayPort } from '../../workspace-runtime/workspace-runtime-gateway.port';
import { requestHash, requireIdempotencyKey } from '../runs/idempotency';
import type { RunExecutionReaderPort, RunSnapshotReaderPort } from '../runs/run.repository.port';
import type { CheckpointRecoveryCommitPort } from '../runs/state-commit.port';
import { runModelRoutes, sameModelRef } from '../runs/model-routes';
import { TERMINAL_RUN_STATUSES, type RunBudget, type RunDefinitionSnapshot, type RunView } from '../runs/run.types';

export type RecoverySafePointReason = 'model_boundary' | 'read_batch' | 'mutation_confirmed' | 'restart_recapture';

const RECOVERY_CHECKPOINT_MIN_INTERVAL_SECONDS = 30;

const clampBudget = (
  source: RunBudget,
  settings: Awaited<ReturnType<AgentSettingsService['get']>>,
): RunBudget => {
  const hard = settings.hardLimits;
  return {
    contextPolicy: { ...source.contextPolicy },
    maxRunSteps: Math.min(source.maxRunSteps, hard.maxRunSteps),
    maxActiveExecutionSeconds: Math.min(source.maxActiveExecutionSeconds, hard.maxActiveExecutionSeconds),
    toolTimeoutSeconds: Math.min(source.toolTimeoutSeconds, hard.toolTimeoutSeconds),
    maxToolOutputBytes: Math.min(source.maxToolOutputBytes, hard.maxToolOutputBytes),
    maxRecallItems: Math.min(source.maxRecallItems, hard.maxRecallItems),
    maxRecallBytes: Math.min(source.maxRecallBytes, hard.maxRecallBytes),
    maxSubagentMessages: Math.min(source.maxSubagentMessages, hard.maxSubagentMessagesPerRun),
    maxSubagentMessageBytes: Math.min(source.maxSubagentMessageBytes, hard.maxSubagentMessageBytesPerRun),
    contextCompactionMode: source.contextCompactionMode,
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
    manifest.delegations.some((delegation) => ['queued', 'running', 'waiting'].includes(delegation.status)) ||
    (manifest.backgroundJobs ?? []).some((job) => ['pending', 'running', 'unknown'].includes(job.status))
  ) {
    reasons.push('CHECKPOINT_NOT_SAFE');
  }
  return reasons;
};

export class CheckpointService {
  private readonly deferredRestartRuns = new Map<string, Scope>();

  constructor(
    private readonly checkpoints: CheckpointRepositoryPort,
    private readonly runs: RunSnapshotReaderPort &
      Partial<Pick<RunExecutionReaderPort, 'rootRuntimeId' | 'rootRuntimeModel'>>,
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
    private readonly workspaceJobs: WorkspaceRuntimeGatewayPort | null = null,
  ) {}

  async save(scope: Scope, runId: string, expectedVersion: number): Promise<CheckpointView> {
    if (!isAgentUuid(runId) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new Error('VALIDATION_FAILED');
    }
    const run = await this.runs.snapshot(scope, runId);
    if (!run) throw new Error('NOT_FOUND');
    if (run.version !== expectedVersion) throw new Error('STATE_CONFLICT');
    return this.saveCheckpoint(scope, run, 'user', null, null, true);
  }

  async recordSafePoint(
    run: RunView,
    reason: RecoverySafePointReason,
    force = reason === 'mutation_confirmed' || reason === 'restart_recapture',
  ): Promise<CheckpointView | null> {
    const scope = { userId: run.userId, appId: run.appId };
    try {
      const current = await this.runs.snapshot(scope, run.id);
      if (
        !current ||
        current.version !== run.version ||
        !['created', 'running', 'interrupted'].includes(current.status) ||
        current.needsReconciliation
      ) {
        return null;
      }
      const latest = await this.checkpoints.latestRecovery(scope, run.id);
      return await this.saveCheckpoint(scope, current, 'recovery', reason, latest, force);
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      if (
        [
          'CHECKPOINT_NOT_SAFE',
          'CHECKPOINT_ARTIFACT_UNAVAILABLE',
          'CHECKPOINT_WORKSPACE_MANIFEST_INVALID',
          'CHECKPOINT_BACKGROUND_JOB_UNRESOLVED',
          'CHECKPOINT_MODEL_ROUTE_INVALID',
          'STATE_CONFLICT',
          'NOT_FOUND',
        ].includes(code)
      ) {
        logger.debug({ runId: run.id, reason, errorCode: code }, 'Agent recovery checkpoint safe point skipped');
        return null;
      }
      logger.warn({ err: error, runId: run.id, reason }, 'Agent recovery checkpoint creation failed');
      return null;
    }
  }

  private async saveCheckpoint(
    scope: Scope,
    run: RunView,
    kind: CheckpointKind,
    reason: RecoverySafePointReason | null,
    latestRecovery: CheckpointView | null,
    force: boolean,
  ): Promise<CheckpointView> {
    const now = this.clock.nowUnixSeconds();
    if (
      kind === 'recovery' &&
      latestRecovery &&
      !force &&
      now - latestRecovery.createdAt < RECOVERY_CHECKPOINT_MIN_INTERVAL_SECONDS
    ) {
      return latestRecovery;
    }

    const app = await this.lifecycle.get(scope);
    const definition = this.definitions.require(scope.appId, app.activeVersion, run.definition.agentDefinitionId);
    const activeModel = this.runs.rootRuntimeModel
      ? await this.runs.rootRuntimeModel(scope, run.id)
      : run.definition.model;
    if (!runModelRoutes(run.definition).some((route) => sameModelRef(route.model, activeModel))) {
      throw new Error('CHECKPOINT_MODEL_ROUTE_INVALID');
    }

    const backgroundJobs = kind === 'recovery' ? await this.liveBackgroundJobs(scope, run.id) : [];
    let workspaceCaptures = [] as Awaited<ReturnType<WorkspaceCheckpointService['capture']>>;
    let workspaceReference:
      | {
          manifestArtifactIds: string[];
          artifactRefs: string[];
        }
      | undefined;

    const mayReuseWorkspace =
      kind === 'recovery' &&
      latestRecovery !== null &&
      reason !== 'mutation_confirmed' &&
      reason !== 'restart_recapture';
    if (mayReuseWorkspace) {
      const hazards = await this.checkpoints.recoveryHazards(scope, latestRecovery.id);
      const manifestArtifactIds = latestRecovery.snapshot.workspaceArtifactManifestRefs;
      const workspaceArtifactRefs = latestRecovery.snapshot.workspaceArtifactRefs;
      if (hazards.postCheckpointMutationToolCallIds.length === 0 && hazards.quarantinedResourceKeys.length === 0) {
        workspaceReference = {
          manifestArtifactIds: [...manifestArtifactIds],
          artifactRefs: [...workspaceArtifactRefs],
        };
      }
    }

    if (!workspaceReference) {
      workspaceCaptures = this.workspaceCheckpoints ? await this.workspaceCheckpoints.capture(scope, run.id) : [];
      if (
        !this.workspaceCheckpoints &&
        latestRecovery &&
        latestRecovery.snapshot.workspaceArtifactManifestRefs.length > 0
      ) {
        throw new Error('CHECKPOINT_WORKSPACE_MANIFEST_INVALID');
      }
    }

    return this.checkpoints.save({
      scope,
      checkpointId: randomUUID(),
      kind,
      runId: run.id,
      expectedRunVersion: run.version,
      definitionVersion: definition.version,
      activeModel,
      workspaceCaptures,
      ...(workspaceReference ? { workspaceReference } : {}),
      backgroundJobs,
      now,
    });
  }

  private async observeBackgroundJobs(
    scope: Scope,
    runId: string,
    allowPending: boolean,
  ): Promise<{ jobs: CheckpointBackgroundJobEntry[]; pending: boolean }> {
    const durable = await this.checkpoints.runBackgroundJobs(scope, runId);
    if (durable.length === 0) return { jobs: [], pending: false };
    if (!this.workspaceJobs) throw new Error('CHECKPOINT_BACKGROUND_JOB_UNRESOLVED');
    const current: CheckpointBackgroundJobEntry[] = [];
    let pending = false;
    for (const recorded of durable) {
      let job;
      try {
        job = await this.workspaceJobs.queryJob(recorded.jobId);
      } catch {
        if (allowPending) return { jobs: current, pending: true };
        throw new Error('CHECKPOINT_BACKGROUND_JOB_UNRESOLVED');
      }
      if (
        job.jobId !== recorded.jobId ||
        job.workspaceId !== recorded.workspaceId ||
        job.generation !== recorded.generation ||
        job.status === 'unknown'
      ) {
        throw new Error('CHECKPOINT_BACKGROUND_JOB_UNRESOLVED');
      }
      if (job.status === 'pending' || job.status === 'running') pending = true;
      current.push({
        jobId: job.jobId,
        workspaceId: job.workspaceId,
        generation: job.generation,
        status: job.status,
      });
    }
    if (pending && !allowPending) throw new Error('CHECKPOINT_BACKGROUND_JOB_UNRESOLVED');
    return { jobs: current, pending };
  }

  private async liveBackgroundJobs(scope: Scope, runId: string): Promise<CheckpointBackgroundJobEntry[]> {
    return (await this.observeBackgroundJobs(scope, runId, false)).jobs;
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
    mode: 'manual' | 'backend_restart' = 'manual',
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
    if (mode === 'manual' && checkpoint.kind !== 'user') reasons.push('CHECKPOINT_USER_KIND_REQUIRED');
    reasons.push(...checkpointRecoveryReasons(checkpoint));
    if (run.version !== expectedVersion) reasons.push('STATE_CONFLICT');
    if (!TERMINAL_RUN_STATUSES.has(run.status)) reasons.push('RUN_RESUME_SOURCE_NOT_TERMINAL');
    if (run.needsReconciliation) reasons.push('RECONCILIATION_REQUIRED');
    const [app, currentSettings] = await Promise.all([this.lifecycle.get(scope), this.settings.get(scope.userId)]);
    const definition = this.definitions.require(scope.appId, app.activeVersion, run.definition.agentDefinitionId);
    if (definition.version !== checkpoint.snapshot.definitionVersion) reasons.push('CHECKPOINT_DEFINITION_STALE');
    const activeModel = checkpoint.snapshot.activeModel;
    const activeRoute = runModelRoutes(run.definition).find((route) => sameModelRef(route.model, activeModel));
    if (!activeRoute) reasons.push('CHECKPOINT_MODEL_ROUTE_INVALID');
    if (mode === 'backend_restart') {
      if (checkpoint.kind !== 'recovery') reasons.push('CHECKPOINT_RECOVERY_KIND_REQUIRED');
      if (checkpoint.snapshot.inputRevision === undefined || checkpoint.snapshot.inputRevision !== run.inputRevision) {
        reasons.push('CHECKPOINT_INPUT_STALE');
      }
      if (
        checkpoint.snapshot.settingsRevision === undefined ||
        checkpoint.snapshot.settingsRevision !== currentSettings.revision
      ) {
        reasons.push('CHECKPOINT_SETTINGS_STALE');
      }
      if (checkpoint.snapshot.policyRevision !== app.policyRevision) reasons.push('CHECKPOINT_POLICY_STALE');
    }
    let provider = null;
    try {
      provider = await this.providers.get(scope.userId, activeModel.providerId);
    } catch {
      reasons.push('CHECKPOINT_PROVIDER_UNAVAILABLE');
    }
    if (provider) {
      if (!provider.enabled || provider.version !== checkpoint.snapshot.modelConfigurationVersion) {
        reasons.push('CHECKPOINT_PROVIDER_STALE');
      } else {
        const model = provider.models.find((candidate) => candidate.id === activeModel.modelId);
        if (!model) {
          reasons.push('CHECKPOINT_MODEL_UNAVAILABLE');
        } else {
          const requirements = run.definition.requiredModelCapabilities;
          const capabilities = activeRoute?.modelCapabilities;
          if (!capabilities) {
            reasons.push('CHECKPOINT_MODEL_ROUTE_INVALID');
          } else if (missingRequiredModelCapabilities(requirements, capabilities).length > 0) {
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
    const backgroundJobs = checkpoint.snapshot.recoveryManifest.backgroundJobs;
    if (backgroundJobs.length > 0) {
      if (!this.workspaceJobs) {
        reasons.push('CHECKPOINT_BACKGROUND_JOB_UNRESOLVED');
      } else {
        for (const recorded of backgroundJobs) {
          try {
            const current = await this.workspaceJobs.queryJob(recorded.jobId);
            if (
              current.jobId !== recorded.jobId ||
              current.workspaceId !== recorded.workspaceId ||
              current.generation !== recorded.generation ||
              current.status !== recorded.status ||
              ['pending', 'running', 'unknown'].includes(current.status)
            ) {
              reasons.push('CHECKPOINT_BACKGROUND_JOB_UNRESOLVED');
              break;
            }
          } catch {
            reasons.push('CHECKPOINT_BACKGROUND_JOB_UNRESOLVED');
            break;
          }
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

  async recoverInterrupted(interruptedRuns: readonly RunView[]): Promise<RunView[]> {
    const resumed: RunView[] = [];
    for (const interrupted of interruptedRuns) {
      if (interrupted.status !== 'interrupted' || interrupted.needsReconciliation) {
        this.deferredRestartRuns.delete(interrupted.id);
        continue;
      }
      const scope = { userId: interrupted.userId, appId: interrupted.appId };
      let checkpoint: CheckpointView | null = null;
      try {
        checkpoint = await this.checkpoints.latestRecovery(scope, interrupted.id);
        if (!checkpoint) {
          await this.auditRecoveryFailure(interrupted, null, ['CHECKPOINT_NOT_FOUND']);
          continue;
        }
        const hazards = await this.checkpoints.recoveryHazards(scope, checkpoint.id);
        if (hazards.quarantinedResourceKeys.length > 0) {
          await this.auditRecoveryFailure(interrupted, checkpoint.id, ['RECONCILIATION_REQUIRED']);
          continue;
        }
        if (hazards.postCheckpointMutationToolCallIds.length > 0) {
          const jobs = await this.checkpoints.runBackgroundJobs(scope, interrupted.id);
          const backgroundToolIds = new Set(jobs.flatMap((job) => job.toolCallIds));
          if (
            jobs.length === 0 ||
            hazards.postCheckpointMutationToolCallIds.some((toolCallId) => !backgroundToolIds.has(toolCallId))
          ) {
            await this.auditRecoveryFailure(interrupted, checkpoint.id, ['CHECKPOINT_SIDE_EFFECT_DIVERGED']);
            continue;
          }
          try {
            const observed = await this.observeBackgroundJobs(scope, interrupted.id, true);
            if (observed.pending) {
              await this.deferRecovery(
                interrupted,
                checkpoint.id,
                jobs.map((job) => job.jobId),
              );
              continue;
            }
          } catch {
            await this.auditRecoveryFailure(interrupted, checkpoint.id, ['CHECKPOINT_BACKGROUND_JOB_UNRESOLVED']);
            continue;
          }
          checkpoint = await this.recordSafePoint(interrupted, 'restart_recapture', true);
          if (!checkpoint) {
            await this.auditRecoveryFailure(interrupted, null, ['CHECKPOINT_RECAPTURE_FAILED']);
            continue;
          }
        }

        const current = await this.runs.snapshot(scope, interrupted.id);
        if (!current || current.status !== 'interrupted') {
          this.deferredRestartRuns.delete(interrupted.id);
          continue;
        }
        const validation = await this.validate(scope, current.id, checkpoint.id, current.version, 'backend_restart');
        if (!validation.valid) {
          await this.auditRecoveryFailure(current, checkpoint.id, validation.reasons);
          continue;
        }
        const continued = await this.resume(
          scope,
          current.id,
          checkpoint.id,
          current.version,
          checkpoint.id,
          'backend_restart',
        );
        this.deferredRestartRuns.delete(interrupted.id);
        resumed.push(continued);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await this.auditRecoveryFailure(interrupted, checkpoint?.id ?? null, [reason]);
      }
    }
    return resumed;
  }

  async retryDeferredRecoveries(): Promise<number> {
    let recovered = 0;
    for (const [runId, scope] of [...this.deferredRestartRuns]) {
      let checkpoint: CheckpointView | null;
      let source: RunView | null;
      try {
        [checkpoint, source] = await Promise.all([
          this.checkpoints.latestRecovery(scope, runId),
          this.runs.snapshot(scope, runId),
        ]);
      } catch (error) {
        logger.warn({ err: error, runId }, 'Agent deferred restart-recovery lookup failed; retry remains scheduled');
        continue;
      }
      if (!source || source.status !== 'interrupted' || source.needsReconciliation) {
        this.deferredRestartRuns.delete(runId);
        continue;
      }
      if (!checkpoint) {
        this.deferredRestartRuns.delete(runId);
        await this.auditRecoveryFailure(source, null, ['CHECKPOINT_NOT_FOUND']);
        continue;
      }
      recovered += (await this.recoverInterrupted([source])).length;
    }
    return recovered;
  }

  private async deferRecovery(run: RunView, checkpointId: string, jobIds: readonly string[]): Promise<void> {
    if (this.deferredRestartRuns.has(run.id)) return;
    const scope = { userId: run.userId, appId: run.appId };
    const current = await this.runs.snapshot(scope, run.id);
    if (!current || current.status !== 'interrupted' || current.needsReconciliation) return;
    const committed = await this.stateCommit.commit({
      scope,
      runId: current.id,
      expectedRunVersion: current.version,
      events: [
        {
          type: 'run.recovery_deferred',
          payload: {
            reason: 'backend_restart',
            checkpointId,
            waitingFor: 'workspace_background_jobs',
            jobIds: [...new Set(jobIds)].sort(),
          },
        },
      ],
      runPatch: {},
      now: this.clock.nowUnixSeconds(),
    });
    this.deferredRestartRuns.set(run.id, scope);
    this.onCommitted(committed.run);
  }

  private async auditRecoveryFailure(
    run: RunView,
    checkpointId: string | null,
    reasons: readonly string[],
  ): Promise<void> {
    this.deferredRestartRuns.delete(run.id);
    try {
      const current = await this.runs.snapshot({ userId: run.userId, appId: run.appId }, run.id);
      if (!current || current.status !== 'interrupted') return;
      const committed = await this.stateCommit.commit({
        scope: { userId: run.userId, appId: run.appId },
        runId: run.id,
        expectedRunVersion: current.version,
        events: [
          {
            type: 'run.recovery_failed',
            payload: {
              reason: 'backend_restart',
              checkpointId,
              reasons: [...new Set(reasons)].slice(0, 32),
            },
          },
        ],
        runPatch: {},
        now: this.clock.nowUnixSeconds(),
      });
      this.onCommitted(committed.run);
    } catch (error) {
      logger.warn(
        { err: error, runId: run.id, checkpointId },
        'Agent restart recovery failure audit could not be committed',
      );
    }
  }

  async resume(
    scope: Scope,
    runId: string,
    checkpointId: string,
    expectedVersion: number,
    idempotencyKey: string,
    mode: 'manual' | 'backend_restart' = 'manual',
  ): Promise<RunView> {
    const key = requireIdempotencyKey(idempotencyKey);
    const validation = await this.validate(scope, runId, checkpointId, expectedVersion, mode);
    if (!validation.valid || !validation.checkpoint) throw new Error(validation.reasons[0] ?? 'CHECKPOINT_INVALID');
    const source = await this.runs.snapshot(scope, runId);
    if (!source) throw new Error('NOT_FOUND');
    const recoveryManifest = validation.checkpoint.snapshot.recoveryManifest;
    const activeModel = validation.checkpoint.snapshot.activeModel;
    const activeRoute = runModelRoutes(source.definition).find((route) => sameModelRef(route.model, activeModel));
    if (!activeRoute) throw new Error('CHECKPOINT_MODEL_ROUTE_INVALID');
    const [settings, app, provider] = await Promise.all([
      this.settings.get(scope.userId),
      this.lifecycle.get(scope),
      this.providers.get(scope.userId, activeModel.providerId),
    ]);
    if (!settings.effectiveSettings.feature.enabled) throw new Error('AGENT_DISABLED');
    if (app.desiredState !== 'enabled' || !['running', 'degraded'].includes(app.observedState))
      throw new Error('AGENT_APP_DISABLED');
    if (!app.acceptNewRuns) throw new Error('AGENT_APP_DRAINING');
    if (!provider.enabled || provider.version !== validation.checkpoint.snapshot.modelConfigurationVersion) {
      throw new Error('CHECKPOINT_PROVIDER_STALE');
    }
    const model = provider.models.find((candidate) => candidate.id === activeModel.modelId);
    if (!model) throw new Error('CHECKPOINT_MODEL_UNAVAILABLE');
    const definitionInfo = this.definitions.require(
      scope.appId,
      app.activeVersion,
      source.definition.agentDefinitionId,
    );
    if (definitionInfo.version !== validation.checkpoint.snapshot.definitionVersion) {
      throw new Error('CHECKPOINT_DEFINITION_STALE');
    }
    const requirements = source.definition.requiredModelCapabilities;
    const capabilities = activeRoute.modelCapabilities;
    if (missingRequiredModelCapabilities(requirements, capabilities).length > 0) {
      throw new Error('CHECKPOINT_MODEL_CAPABILITY_UNSUPPORTED');
    }
    const budget = clampBudget(source.budget, settings);
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
      ...(sameModelRef(activeModel, source.definition.model) ? { modelCapabilities: capabilities } : {}),
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
      mode,
      activeModel: { ...activeModel },
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
          type: mode === 'backend_restart' ? 'continued_from_checkpoint' : 'checkpoint.resume',
          ...(mode === 'backend_restart' ? { reason: 'backend_restart' } : {}),
          sourceRunId: source.id,
          checkpointId,
          ledgerThrough: validation.checkpoint.ledgerThrough,
          eventThrough: validation.checkpoint.eventThrough,
          activeModel: { ...activeModel },
          backgroundJobs: (recoveryManifest.backgroundJobs ?? []).map((job) => ({ ...job })),
          contextBoundary: {
            baseThrough: recoveryManifest.contextBoundary.baseThrough,
            runThrough: { ...recoveryManifest.contextBoundary.runThrough },
          },
        },
        artifactRefs: refs,
      },
      initialPlan: validation.checkpoint.snapshot.plan,
      initialGoal: validation.checkpoint.snapshot.goal,
      agentDefinitionId: source.definition.agentDefinitionId,
      model: activeModel,
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
      if (!this.workspaceCheckpoints || !this.runs.rootRuntimeId) {
        throw new Error('CHECKPOINT_WORKSPACE_MANIFEST_INVALID');
      }
      const resumedRuntimeId = await this.runs.rootRuntimeId(scope, committed.run.id);
      await this.workspaceCheckpoints.restore(scope, committed.run.id, resumedRuntimeId, workspaceManifests);
    }
    if (mode === 'backend_restart' && !committed.replayed) {
      const sourceAudit = await this.stateCommit.commit({
        scope,
        runId: source.id,
        expectedRunVersion: source.version,
        events: [
          {
            type: 'run.recovery_continued',
            payload: {
              reason: 'backend_restart',
              checkpointId,
              continuedRunId: committed.run.id,
            },
          },
        ],
        runPatch: {},
        now: this.clock.nowUnixSeconds(),
      });
      this.onCommitted(sourceAudit.run);
    }
    await this.stateCommit.supersedeRunApprovals(scope, source.id, this.clock.nowUnixSeconds());
    if (!committed.replayed) {
      this.onCommitted(committed.run);
      this.onCreated(committed.run);
    }
    return committed.run;
  }
}
