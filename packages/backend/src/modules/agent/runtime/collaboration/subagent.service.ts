import { randomUUID } from 'node:crypto';
import { logger } from '../../../../shared/logging/logger';
import type { JsonValue, Scope, ClockPort } from '../../agent.types';
import { snapshotProviderModelCapabilities } from '../../ai/model-capability-resolver';
import type { ProviderService } from '../../ai/provider.service';
import type { AppGrantRepositoryPort } from '../../host/app-grant.repository.port';
import { CapabilityRegistry } from '../../host/capability-registry';
import type { AgentCapability } from '../../host/capability.types';
import type { HostCursorReaderPort, RunSnapshotReaderPort } from '../runs/run.repository.port';
import { requestHash, requireIdempotencyKey } from '../runs/idempotency';
import type { DelegationRepositoryPort, RuntimeParticipantRepositoryPort } from './subagent.repository.port';
import type { DelegationView, DependencyMode, JoinResult, SubagentProfile } from './subagent.types';
import type { SubagentPolicyService } from './subagent-policy';
import type { AgentEventHub } from '../events/event-hub';

const MAX_OBJECTIVE_BYTES = 16 * 1024;
const MAX_CONSTRAINTS = 32;
const MAX_CONSTRAINT_BYTES = 2 * 1024;
const MAX_ARTIFACT_REFS = 64;
const MAX_CRITERIA = 32;
const MAX_DEPENDENCIES = 64;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const nonEmpty = (value: unknown, maxBytes: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && Buffer.byteLength(value.trim(), 'utf8') <= maxBytes;
const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const stringArray = (value: unknown, maxItems: number, maxItemBytes: number): string[] => {
  if (!Array.isArray(value) || value.length > maxItems || !value.every((item) => nonEmpty(item, maxItemBytes))) {
    throw new Error('VALIDATION_FAILED');
  }
  const result = value.map((item) => (item as string).trim());
  if (new Set(result).size !== result.length) throw new Error('VALIDATION_FAILED');
  return result;
};

interface ParsedRequest {
  profileId: string;
  objective: string;
  constraints: string[];
  inputArtifactRefs: string[];
  maxSteps: number;
  deadlineAt: number;
  completionCriteria: string[];
  dependsOn: string[];
  dependencyMode: DependencyMode;
}

const parseRequest = (raw: unknown, now: number): ParsedRequest => {
  if (!isRecord(raw)) throw new Error('VALIDATION_FAILED');
  const allowed = new Set([
    'profileId',
    'objective',
    'constraints',
    'inputArtifactRefs',
    'maxSteps',
    'deadlineAt',
    'completionCriteria',
    'dependsOn',
    'dependencyMode',
  ]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) throw new Error('VALIDATION_FAILED');
  if (!nonEmpty(raw.profileId, 64) || !nonEmpty(raw.objective, MAX_OBJECTIVE_BYTES))
    throw new Error('VALIDATION_FAILED');
  if (!positiveInteger(raw.maxSteps)) throw new Error('VALIDATION_FAILED');
  if (!Number.isSafeInteger(raw.deadlineAt) || (raw.deadlineAt as number) <= now) throw new Error('VALIDATION_FAILED');
  if (!['success', 'settled'].includes(String(raw.dependencyMode))) throw new Error('VALIDATION_FAILED');
  return {
    profileId: raw.profileId.trim(),
    objective: raw.objective.trim(),
    constraints: stringArray(raw.constraints, MAX_CONSTRAINTS, MAX_CONSTRAINT_BYTES),
    inputArtifactRefs: stringArray(raw.inputArtifactRefs, MAX_ARTIFACT_REFS, 256),
    maxSteps: raw.maxSteps,
    deadlineAt: raw.deadlineAt as number,
    completionCriteria: stringArray(raw.completionCriteria, MAX_CRITERIA, MAX_CONSTRAINT_BYTES),
    dependsOn: stringArray(raw.dependsOn, MAX_DEPENDENCIES, 128),
    dependencyMode: raw.dependencyMode as DependencyMode,
  };
};

const modelKey = (model: { providerId: string; modelId: string; configurationVersion: number }): string =>
  `${model.providerId}\u0000${model.modelId}\u0000${model.configurationVersion}`;

export class SubagentService {
  constructor(
    private readonly delegations: DelegationRepositoryPort,
    private readonly runtimes: RuntimeParticipantRepositoryPort,
    private readonly runs: RunSnapshotReaderPort & HostCursorReaderPort,
    private readonly policy: SubagentPolicyService,
    private readonly providers: ProviderService,
    private readonly grants: AppGrantRepositoryPort,
    private readonly capabilities: CapabilityRegistry,
    private readonly events: AgentEventHub,
    private readonly clock: ClockPort,
    private readonly onWorkAvailable: () => void = () => undefined,
    private readonly onRuntimeCancelled: (runId: string, runtimeId: string) => void = () => undefined,
  ) {}

  async create(
    scope: Scope,
    runId: string,
    parentRuntimeId: string,
    raw: unknown,
    idempotencyKey: string,
  ): Promise<DelegationView> {
    const key = requireIdempotencyKey(idempotencyKey);
    const now = this.clock.nowUnixSeconds();
    const input = parseRequest(raw, now);
    const [run, parentRuntime, settings, allDelegations] = await Promise.all([
      this.runs.snapshot(scope, runId),
      this.runtimes.runtime(scope, runId, parentRuntimeId),
      this.policy.get(scope),
      this.delegations.listDelegations(scope, runId),
    ]);
    if (!run) throw new Error('RUN_NOT_FOUND');
    if (!parentRuntime) throw new Error('AGENT_RUNTIME_NOT_FOUND');
    if (!['created', 'running', 'awaiting_approval', 'awaiting_budget', 'awaiting_input'].includes(run.status))
      throw new Error('RUN_NOT_ACTIVE');
    const parentDelegation = allDelegations.find((delegation) => delegation.childRuntimeId === parentRuntimeId) ?? null;
    const depth = (parentDelegation?.depth ?? 0) + 1;
    if (depth > settings.policy.maxDelegationDepth) throw new Error('DELEGATION_DEPTH_EXCEEDED');
    const profile = settings.policy.profiles.find((candidate) => candidate.id === input.profileId);
    if (!profile) throw new Error('SUBAGENT_PROFILE_NOT_FOUND');
    const model = this.selectModel(profile, run.definition.model);
    const provider = await this.providers.get(scope.userId, model.providerId);
    const configuredModel = provider.models.find((candidate) => candidate.id === model.modelId);
    if (!provider.enabled || provider.version !== model.configurationVersion || !configuredModel) {
      throw new Error('SUBAGENT_MODEL_UNAVAILABLE');
    }
    const modelCapabilities = snapshotProviderModelCapabilities(configuredModel);
    const appGrants = await this.grants.list(scope);
    const delegatedGrants = profile.capabilities.flatMap((capability: AgentCapability) => {
      const appGrant = appGrants.find((grant) => grant.capability === capability);
      if (!appGrant) return [];
      const parentGrant = parentDelegation?.grants.find((grant) => grant.capability === capability);
      if (parentDelegation && !parentGrant) return [];
      const inheritedScope = parentGrant
        ? this.capabilities.intersect(capability, appGrant.scope, parentGrant.scope)
        : appGrant.scope;
      if (!inheritedScope) return [];
      const delegatedScope = capability.startsWith('file.')
        ? this.capabilities.restrictTargets(capability, inheritedScope, ['workspace'])
        : inheritedScope;
      return delegatedScope ? [{ capability, schemaVersion: 2 as const, scope: delegatedScope }] : [];
    });
    const delegationId = randomUUID();
    const childRuntimeId = randomUUID();
    const payload = {
      schemaVersion: 2,
      runId,
      parentRuntimeId,
      profileId: profile.id,
      objective: input.objective,
      constraints: input.constraints,
      inputArtifactRefs: input.inputArtifactRefs,
      maxSteps: Math.min(input.maxSteps, profile.maxSteps),
      deadlineAt: input.deadlineAt,
      completionCriteria: input.completionCriteria,
      dependsOn: input.dependsOn,
      dependencyMode: input.dependencyMode,
      model: model as unknown as JsonValue,
      grants: delegatedGrants.map((grant) => ({
        capability: grant.capability,
        schemaVersion: grant.schemaVersion,
        scope: this.capabilities.toJson(grant.scope),
      })),
      peerMessaging: profile.peerMessaging,
      mutationMode: profile.mutationMode,
    } satisfies JsonValue;
    const created = await this.delegations.createDelegation({
      scope,
      id: delegationId,
      runId,
      parentRuntimeId,
      childRuntimeId,
      participantId: `subagent:${delegationId}`,
      profileId: profile.id,
      grants: delegatedGrants,
      peerMessaging: profile.peerMessaging,
      mutationMode: profile.mutationMode,
      modelRef: model,
      modelCapabilities,
      objective: input.objective,
      constraints: input.constraints,
      inputArtifactRefs: input.inputArtifactRefs,
      completionCriteria: input.completionCriteria,
      dependencyMode: input.dependencyMode,
      dependsOn: input.dependsOn,
      depth,
      failureMode: profile.failureMode,
      maxSteps: Math.min(input.maxSteps, profile.maxSteps),
      idempotencyKey: key,
      requestHash: requestHash(1, payload),
      deadlineAt: input.deadlineAt,
      now,
    });
    await this.wake(scope, runId);
    this.onWorkAvailable();
    logger.info(
      {
        userId: scope.userId,
        appId: scope.appId,
        runId,
        delegationId: created.delegation.id,
        parentRuntimeId,
        childRuntimeId: created.delegation.childRuntimeId,
        profileId: created.delegation.profileId,
        depth: created.delegation.depth,
        grantCount: created.delegation.grants.length,
      },
      'Agent Subagent delegation created',
    );
    return created.delegation;
  }

  async list(
    scope: Scope,
    runId: string,
    parentRuntimeId?: string,
    limit?: number,
    before?: { createdAt: number; id: string },
  ): Promise<DelegationView[]> {
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > 101))
      throw new Error('VALIDATION_FAILED');
    return this.delegations.listDelegations(scope, runId, parentRuntimeId, limit, before);
  }

  async cancelTree(
    scope: Scope,
    runId: string,
    delegationId: string,
    expectedVersion: number,
  ): Promise<DelegationView> {
    const current = await this.delegations.delegation(scope, runId, delegationId);
    if (!current) throw new Error('DELEGATION_NOT_FOUND');
    const descendants = await this.delegations.descendants(scope, runId, current.childRuntimeId);
    for (const descendant of descendants) {
      if (!['completed', 'failed', 'cancelled'].includes(descendant.status)) {
        const cancelled = await this.delegations.cancelDelegation(
          scope,
          runId,
          descendant.id,
          descendant.version,
          this.clock.nowUnixSeconds(),
        );
        this.onRuntimeCancelled(runId, cancelled.childRuntimeId);
      }
    }
    const result = await this.delegations.cancelDelegation(
      scope,
      runId,
      delegationId,
      expectedVersion,
      this.clock.nowUnixSeconds(),
    );
    this.onRuntimeCancelled(runId, result.childRuntimeId);
    await this.wake(scope, runId);
    logger.info(
      {
        userId: scope.userId,
        appId: scope.appId,
        runId,
        delegationId,
        childRuntimeId: result.childRuntimeId,
        cancelledDescendants: descendants.length,
        version: result.version,
      },
      'Agent Subagent delegation tree cancelled',
    );
    return result;
  }

  async pollJoin(
    scope: Scope,
    runId: string,
    callerRuntimeId: string,
    delegationIds: readonly string[],
    mode: 'all' | 'any',
    deadlineAt: number,
  ): Promise<JoinResult & { ready: boolean }> {
    const ids = [...new Set(delegationIds)];
    if (
      ids.length < 1 ||
      ids.length > MAX_DEPENDENCIES ||
      !['all', 'any'].includes(mode) ||
      !Number.isSafeInteger(deadlineAt)
    ) {
      throw new Error('VALIDATION_FAILED');
    }
    const values = await Promise.all(ids.map((id) => this.delegations.delegation(scope, runId, id)));
    if (values.some((value) => value === null)) throw new Error('DELEGATION_NOT_FOUND');
    const delegations = values as DelegationView[];
    if (delegations.some((delegation) => delegation.parentRuntimeId !== callerRuntimeId)) {
      throw new Error('DELEGATION_JOIN_FORBIDDEN');
    }
    const settled = delegations.filter((value) => ['completed', 'failed', 'cancelled'].includes(value.status));
    const running = delegations.filter((value) => !['completed', 'failed', 'cancelled'].includes(value.status));
    const timedOut = running.length > 0 && this.clock.nowUnixSeconds() >= deadlineAt;
    const ready = timedOut || (mode === 'all' ? running.length === 0 : settled.length > 0);
    return { settled, running, timedOut, ready };
  }

  async join(
    scope: Scope,
    runId: string,
    callerRuntimeId: string,
    delegationIds: readonly string[],
    mode: 'all' | 'any',
    deadlineAt: number,
    signal: AbortSignal,
  ): Promise<JoinResult> {
    while (true) {
      if (signal.aborted) throw signal.reason ?? new Error('ABORTED');
      const result = await this.pollJoin(scope, runId, callerRuntimeId, delegationIds, mode, deadlineAt);
      if (result.ready) return { settled: result.settled, running: result.running, timedOut: result.timedOut };
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer);
          reject(signal.reason ?? new Error('ABORTED'));
        };
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        }, 250);
        signal.addEventListener('abort', onAbort, { once: true });
      });
    }
  }

  private selectModel(profile: SubagentProfile, parentModel: SubagentProfile['allowedModels'][number]) {
    const selected = profile.defaultModel ?? parentModel;
    const allowed = new Set(profile.allowedModels.map(modelKey));
    if (!allowed.has(modelKey(selected))) throw new Error('SUBAGENT_MODEL_NOT_ALLOWED');
    return selected;
  }

  private async wake(scope: Scope, runId: string): Promise<void> {
    const snapshot = await this.runs.snapshot(scope, runId);
    if (!snapshot) return;
    this.events.publishRunWake(runId, snapshot.eventCursor);
    const hostCursor = await this.runs.hostCursor(scope.userId);
    this.events.publishHostWake(scope.userId, hostCursor);
  }
}
