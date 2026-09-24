import assert from 'node:assert/strict';
import type WebSocket from 'ws';
import { AgentProtocolSession } from '../../packages/backend/src/interfaces/websocket/agent-protocol.session';
import type { AgentEventFacade, AgentRunFacade } from '../../packages/backend/src/modules/agent/public';

const sleep = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

const waitUntil = async (predicate: () => boolean, timeoutMs = 500): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('TEST_TIMEOUT');
    await sleep(5);
  }
};

const main = async (): Promise<void> => {
  const wire: Array<Record<string, unknown>> = [];
  const socket = {
    readyState: 1,
    bufferedAmount: 0,
    send: (value: string) => wire.push(JSON.parse(value) as Record<string, unknown>),
    close: () => undefined,
  } as unknown as WebSocket;

  let committed = false;
  let hostCursorCalls = 0;
  let readHostCalls = 0;
  let initialDrainResolve: (() => void) | undefined;
  const initialDrain = new Promise<void>((resolve) => {
    initialDrainResolve = resolve;
  });

  const events = {
    readRun: async () => [],
    readHost: async (_userId: number, after: number) => {
      readHostCalls += 1;
      if (readHostCalls === 1) initialDrainResolve?.();
      if (!committed || after >= 1) return [];
      return [
        {
          userId: 1,
          sequence: 1,
          type: 'summary.changed' as const,
          payload: { source: 'committed-without-wake' },
          occurredAt: 123,
        },
      ];
    },
    hostCursor: async () => {
      hostCursorCalls += 1;
      if (hostCursorCalls === 1) throw new Error('INJECTED_CURSOR_FAILURE');
      return committed ? 1 : 0;
    },
    hostCursorWindow: async () => ({ oldestAvailableCursor: 0, highWater: 0 }),
    onRunWake: () => () => undefined,
    onHostWake: () => () => undefined,
    onTransient: () => () => undefined,
  } as unknown as AgentEventFacade;

  const session = new AgentProtocolSession(
    socket,
    { userId: 1 },
    { events, runs: {} as AgentRunFacade },
    { hostPollIntervalMs: 10 },
  );
  await session.handleMessage(
    Buffer.from(
      JSON.stringify({
        type: 'subscribe',
        requestId: 'wake-recovery-request',
        payload: { subscriptionId: 'host-recovery', channel: 'host', cursor: 0 },
      }),
    ),
    false,
  );
  await initialDrain;

  committed = true;
  await waitUntil(() =>
    wire.some(
      (message) =>
        message.type === 'event' &&
        (message.payload as { subscriptionId?: string; sequence?: number } | undefined)?.subscriptionId ===
          'host-recovery' &&
        (message.payload as { sequence?: number } | undefined)?.sequence === 1,
    ),
  );

  assert(hostCursorCalls >= 2, 'periodic host polling must retry after a transient durable cursor query failure');
  assert(readHostCalls >= 2, 'durable outbox must be drained again without any in-memory wake');
  const delivered = wire.find(
    (message) =>
      message.type === 'event' &&
      (message.payload as { subscriptionId?: string } | undefined)?.subscriptionId === 'host-recovery',
  );
  assert.deepEqual(delivered, {
    type: 'event',
    payload: {
      subscriptionId: 'host-recovery',
      durability: 'durable',
      sequence: 1,
      eventType: 'summary.changed',
      payload: { source: 'committed-without-wake' },
      occurredAt: 123,
    },
  });

  await session.close();
  const callsAfterClose = hostCursorCalls;
  await sleep(35);
  assert.equal(hostCursorCalls, callsAfterClose, 'closing the session must stop durable cursor polling');

  process.stdout.write('agent host event wake recovery regression: PASS\n');
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
