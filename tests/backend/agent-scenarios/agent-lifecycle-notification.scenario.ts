import assert from 'node:assert/strict';
import { AgentNotificationBridge } from '../../../packages/backend/src/bootstrap/agent/agent-notification-bridge';
import { NotificationService } from '../../../packages/backend/src/modules/notifications/notification.service';
import type { JsonValue } from '../../../packages/backend/src/modules/agent/agent.types';
import { AgentBenchmarkCase, benchmarkSnapshot } from './scenario-benchmark-helpers';

export const agentLifecycleNotificationScenario = async () => {
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
