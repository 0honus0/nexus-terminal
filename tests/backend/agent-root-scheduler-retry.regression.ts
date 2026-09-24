import assert from 'node:assert/strict';
import type { ClockPort } from '../../packages/backend/src/modules/agent/agent.types';
import type { AgentSettingsService } from '../../packages/backend/src/modules/agent/host/agent-settings.service';
import type { AgentBackendPort } from '../../packages/backend/src/modules/agent/runtime/execution/agent-backend.port';
import { AgentEventHub } from '../../packages/backend/src/modules/agent/runtime/events/event-hub';
import type { RunView } from '../../packages/backend/src/modules/agent/runtime/runs/run.types';
import { AgentScheduler } from '../../packages/backend/src/modules/agent/runtime/scheduling/scheduler';

const clock: ClockPort = {
  nowUnixSeconds: () => Math.floor(Date.now() / 1000),
  nowUnixMilliseconds: () => Date.now(),
};

const settingsResult = {
  effectiveSettings: {
    performance: { maxConcurrentRuntimes: 4 },
    hardLimits: { maxConcurrentRuntimes: 4 },
  },
};

const makeRun = (id: string): RunView =>
  ({
    id,
    userId: 1,
    appId: 'fixture.scheduler',
    threadId: `thread-${id}`,
    status: 'running',
    definition: {
      model: { providerId: 'fixture-provider', modelId: 'fixture-model' },
    },
  }) as unknown as RunView;

const waitUntil = async (predicate: () => boolean, timeoutMs = 2_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert(predicate(), 'condition did not become true before timeout');
};

const main = async (): Promise<void> => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);

  try {
    let settingsCalls = 0;
    let preflightBackendCalls = 0;
    const flakySettings = {
      get: async () => {
        settingsCalls += 1;
        if (settingsCalls === 1) throw new Error('SETTINGS_TRANSIENT');
        return settingsResult;
      },
    } as unknown as AgentSettingsService;
    const preflightBackend: AgentBackendPort = {
      async *execute() {
        preflightBackendCalls += 1;
      },
    };
    const preflightScheduler = new AgentScheduler(
      flakySettings,
      preflightBackend,
      new AgentEventHub(),
      clock,
      async () => 0,
    );
    preflightScheduler.enqueue(makeRun('preflight-retry'));
    await waitUntil(() => preflightBackendCalls === 1);
    assert(settingsCalls >= 2, 'settings failure must retain and retry the dequeued run');
    await preflightScheduler.quiesce(clock.nowUnixSeconds() + 1);

    let executionAttempts = 0;
    const stableSettings = {
      get: async () => settingsResult,
    } as unknown as AgentSettingsService;
    const recoveryFlakyBackend: AgentBackendPort = {
      async *execute() {
        executionAttempts += 1;
        if (executionAttempts === 1) throw new Error('STATE_COMMIT_TRANSIENT');
      },
    };
    const executionScheduler = new AgentScheduler(
      stableSettings,
      recoveryFlakyBackend,
      new AgentEventHub(),
      clock,
      async () => 0,
    );
    executionScheduler.enqueue(makeRun('execution-retry'));
    await waitUntil(() => executionAttempts >= 2);
    assert.equal(executionAttempts, 2, 'backend recovery failure must requeue the same root run');
    await executionScheduler.quiesce(clock.nowUnixSeconds() + 1);

    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(unhandled, [], 'scheduler pump/retry paths must not leak unhandled promise rejections');
    process.stdout.write('agent root scheduler retry regression: PASS\n');
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
