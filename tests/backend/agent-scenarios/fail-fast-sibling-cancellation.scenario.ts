import assert from 'node:assert/strict';
import type { ClockPort, Scope } from '../../../packages/backend/src/modules/agent/agent.types';
import { SubagentCompletionCoordinator } from '../../../packages/backend/src/modules/agent/runtime/collaboration/subagent-completion-coordinator';
import type {
  DelegationView,
  SchedulerWorkView,
} from '../../../packages/backend/src/modules/agent/runtime/collaboration/subagent.types';

export const failFastSiblingCancellationScenario = async () => {
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
