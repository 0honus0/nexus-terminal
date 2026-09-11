import { randomUUID } from 'node:crypto';
import type { JsonValue, Scope, ClockPort } from '../../agent.types';
import type { ProviderService } from '../../ai/provider.service';
import type { AppCapabilityBroker } from '../../host/app-capability-broker';
import type { AgentCapability } from '../../host/app.types';
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
  maxTokens: number;
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
    'maxTokens',
    'maxSteps',
    'deadlineAt',
    'completionCriteria',
    'dependsOn',
    'dependencyMode',
  ]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) throw new Error('VALIDATION_FAILED');
  if (!nonEmpty(raw.profileId, 64) || !nonEmpty(raw.objective, MAX_OBJECTIVE_BYTES))
    throw new Error('VALIDATION_FAILED');
  if (!positiveInteger(raw.maxTokens) || !positiveInteger(raw.maxSteps)) throw new Error('VALIDATION_FAILED');
  if (!Number.isSafeInteger(raw.deadlineAt) || (raw.deadlineAt as number) <= now) throw new Error('VALIDATION_FAILED');
  if (!['success', 'settled'].includes(String(raw.dependencyMode))) throw new Error('VALIDATION_FAILED');
  return {
    profileId: raw.profileId.trim(),
    objective: raw.objective.trim(),
    constraints: stringArray(raw.constraints, MAX_CONSTRAINTS, MAX_CONSTRAINT_BYTES),
    inputArtifactRefs: stringArray(raw.inputArtifactRefs, MAX_ARTIFACT_REFS, 256),
    maxTokens: raw.maxTokens,
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
    private readonly capabilities: AppCapabilityBroker,
    private readonly events: AgentEventHub,
    private readonly clock: ClockPort,
    private readonly onWorkAvailable: () => void = () => undefined,
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
    if (!['created', 'running', 'awaiting_approval', 'awaiting_budget'].includes(run.status))
      throw new Error('RUN_NOT_ACTIVE');
    const parentDelegation = allDelegations.find((delegation) => delegation.childRuntimeId === parentRuntimeId) ?? null;
    const depth = (parentDelegation?.depth ?? 0) + 1;
    if (depth > settings.policy.maxDelegationDepth) throw new Error('DELEGATION_DEPTH_EXCEEDED');
    const profile = settings.policy.profiles.find((candidate) => candidate.id === input.profileId);
    if (!profile) throw new Error('SUBAGENT_PROFILE_NOT_FOUND');
    const model = this.selectModel(profile, run.definition.model);
    const provider = await this.providers.get(scope.userId, model.providerId);
    if (
      !provider.enabled ||
      provider.version !== model.configurationVersion ||
      !provider.models.some((candidate) => candidate.id === model.modelId)
    ) {
      throw new Error('SUBAGENT_MODEL_UNAVAILABLE');
    }
    const grantedCapabilities: AgentCapability[] = [];
    for (const capability of profile.capabilities as AgentCapability[]) {
      if (parentDelegation && !parentDelegation.capabilities.includes(capability)) continue;
      const decision = await this.capabilities.authorize(scope, capability);
      if (decision.allowed) grantedCapabilities.push(capability);
    }
    const delegationId = randomUUID();
    const childRuntimeId = randomUUID();
    const payload = {
      schemaVersion: 1,
      runId,
      parentRuntimeId,
      profileId: profile.id,
      objective: input.objective,
      constraints: input.constraints,
      inputArtifactRefs: input.inputArtifactRefs,
      maxTokens: Math.min(input.maxTokens, profile.maxTokens),
      maxSteps: Math.min(input.maxSteps, profile.maxSteps),
      deadlineAt: input.deadlineAt,
      completionCriteria: input.completionCriteria,
      dependsOn: input.dependsOn,
      dependencyMode: input.dependencyMode,
      model: model as unknown as JsonValue,
      capabilities: grantedCapabilities,
      peerMessaging: profile.peerMessaging,
    } satisfies JsonValue;
    const created = await this.delegations.createDelegation({
      scope,
      id: delegationId,
      runId,
      parentRuntimeId,
      childRuntimeId,
      participantId: `subagent:${delegationId}`,
      profileId: profile.id,
      capabilities: grantedCapabilities,
      peerMessaging: profile.peerMessaging,
      modelRef: model,
      objective: input.objective,
      constraints: input.constraints,
      inputArtifactRefs: input.inputArtifactRefs,
      completionCriteria: input.completionCriteria,
      dependencyMode: input.dependencyMode,
      dependsOn: input.dependsOn,
      depth,
      failureMode: profile.failureMode,
      maxTokens: Math.min(input.maxTokens, profile.maxTokens),
      maxSteps: Math.min(input.maxSteps, profile.maxSteps),
      reservedTokens: Math.min(input.maxTokens, profile.maxTokens),
      reservedSteps: Math.min(input.maxSteps, profile.maxSteps),
      idempotencyKey: key,
      requestHash: requestHash(1, payload),
      deadlineAt: input.deadlineAt,
      now,
    });
    await this.wake(scope, runId);
    this.onWorkAvailable();
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
        await this.delegations.cancelDelegation(
          scope,
          runId,
          descendant.id,
          descendant.version,
          this.clock.nowUnixSeconds(),
        );
      }
    }
    const result = await this.delegations.cancelDelegation(
      scope,
      runId,
      delegationId,
      expectedVersion,
      this.clock.nowUnixSeconds(),
    );
    await this.wake(scope, runId);
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
