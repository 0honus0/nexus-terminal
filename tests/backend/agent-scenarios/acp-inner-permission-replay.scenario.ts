import assert from 'node:assert/strict';
import type { ClockPort, Scope } from '../../../packages/backend/src/modules/agent/agent.types';
import type { ToolInspection } from '../../../packages/backend/src/modules/agent/capabilities/tool.types';
import { ApprovalService } from '../../../packages/backend/src/modules/agent/runtime/approvals/approval.service';

export const acpInnerPermissionReplayScenario = async () => {
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
