import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { ClockPort, Scope } from '../../../packages/backend/src/modules/agent/agent.types';
import type { ToolContext, ToolInspection } from '../../../packages/backend/src/modules/agent/capabilities/tool.types';
import { AcpPermissionBroker } from '../../../packages/backend/src/modules/agent/runtime/approvals/acp-permission-broker';

export const acpInnerPermissionAbortRaceScenario = async () => {
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
