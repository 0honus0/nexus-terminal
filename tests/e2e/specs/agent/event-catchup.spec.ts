import { expect, test } from '../../support/fixtures';

interface BacklogRaceState {
  delivered: number;
  ids: string[];
  controller: AbortController;
  iterator: AsyncIterator<{ id?: string }>;
  original: typeof WebSocket;
}

test('production Agent subscription drains disconnected backlog and reconnects from its consumed cursor', async ({
  page,
}) => {
  const cursors: number[] = [];
  let disconnect: (() => void) | undefined;
  let unsubscriptions = 0;
  await page.routeWebSocket('**/ws/agent', (socket) => {
    socket.onMessage((data) => {
      const message = JSON.parse(String(data));
      if (message.type === 'unsubscribe') {
        unsubscriptions++;
        return;
      }
      if (message.type !== 'subscribe') return;
      cursors.push(message.payload.cursor);
      socket.send(JSON.stringify({ type: 'subscribed', requestId: message.requestId }));
      const send = (sequence: number) =>
        socket.send(
          JSON.stringify({
            type: 'event',
            payload: {
              subscriptionId: message.payload.subscriptionId,
              durability: 'durable',
              sequence,
              eventType: 'summary.changed',
              schemaVersion: 1,
              payload: {},
            },
          }),
        );
      if (cursors.length === 1) {
        for (let sequence = 1; sequence <= 100; sequence++) send(sequence);
        disconnect = () => socket.close({ code: 1012, reason: 'fixture restart' });
      } else {
        send(100);
        send(101);
      }
    });
  });
  await page.goto('/login');
  await page.evaluate(async () => {
    const modulePath = '/src/features/agent/api/agent-events.ts';
    const { agentEvents } = await import(/* @vite-ignore */ modulePath);
    const OriginalSocket = window.WebSocket;
    let state: BacklogRaceState;
    window.WebSocket = class extends OriginalSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        this.addEventListener('message', (event) => {
          if (JSON.parse(String(event.data)).type === 'event') state.delivered++;
        });
      }
    };
    const controller = new AbortController();
    state = {
      delivered: 0,
      ids: [],
      controller,
      iterator: agentEvents.host(0, controller.signal)[Symbol.asyncIterator](),
      original: OriginalSocket,
    };
    window.agentBacklogRace = state;
    const first = await state.iterator.next();
    state.ids.push(first.value?.id ?? 'missing');
  });
  try {
    await expect.poll(() => page.evaluate(() => window.agentBacklogRace.delivered)).toBe(100);
    disconnect!();
    const result = await page.evaluate(async () => {
      const state = window.agentBacklogRace;
      for (let sequence = 2; sequence <= 100; sequence++) {
        const next = await state.iterator.next();
        state.ids.push(next.value?.id ?? 'missing');
      }
      const disconnected = await state.iterator.next();
      const recovered = await state.iterator.next();
      state.ids.push(recovered.value?.id ?? 'missing');
      return { ids: state.ids, disconnectedType: (disconnected.value as { type?: string })?.type };
    });
    expect(result.ids).toEqual(Array.from({ length: 101 }, (_, index) => String(index + 1)));
    expect(result.disconnectedType).toBe('transport.disconnected');
    expect(cursors).toEqual([0, 100]);
  } finally {
    await page.evaluate(async () => {
      const state = window.agentBacklogRace;
      state.controller.abort();
      await state.iterator.return?.();
      window.WebSocket = state.original;
    });
  }
  await expect.poll(() => unsubscriptions).toBe(1);
});
declare global {
  interface Window {
    agentBacklogRace: BacklogRaceState;
  }
}

test('production Agent subscription preserves arrivals during paused consumption and aborts a remaining backlog', async ({
  page,
}) => {
  let appendBatch: (() => void) | undefined;
  let confirmInitial!: () => void;
  const initialSent = new Promise<void>((resolve) => {
    confirmInitial = resolve;
  });
  let unsubscriptions = 0;
  await page.routeWebSocket('**/ws/agent', (socket) => {
    socket.onMessage((data) => {
      const message = JSON.parse(String(data));
      if (message.type === 'unsubscribe') {
        unsubscriptions++;
        return;
      }
      if (message.type !== 'subscribe') return;
      const send = (sequence: number) =>
        socket.send(
          JSON.stringify({
            type: 'event',
            payload: {
              subscriptionId: message.payload.subscriptionId,
              durability: 'durable',
              sequence,
              eventType: 'summary.changed',
              schemaVersion: 1,
              payload: {},
            },
          }),
        );
      socket.send(JSON.stringify({ type: 'subscribed', requestId: message.requestId }));
      for (let sequence = 1; sequence <= 100; sequence++) send(sequence);
      appendBatch = () => {
        send(100); // Durable duplicate must not be delivered twice.
        for (let sequence = 101; sequence <= 200; sequence++) send(sequence);
      };
      confirmInitial();
    });
  });
  await page.goto('/login');
  await page.evaluate(async () => {
    const modulePath = '/src/features/agent/api/agent-events.ts';
    const { agentEvents } = await import(/* @vite-ignore */ modulePath);
    const OriginalSocket = window.WebSocket;
    const controller = new AbortController();
    let state: BacklogRaceState;
    window.WebSocket = class extends OriginalSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        this.addEventListener('message', (event) => {
          if (JSON.parse(String(event.data)).type === 'event') state.delivered++;
        });
      }
    };
    state = {
      delivered: 0,
      ids: [],
      controller,
      iterator: agentEvents.host(0, controller.signal)[Symbol.asyncIterator](),
      original: OriginalSocket,
    };
    window.agentBacklogRace = state;
    const first = await state.iterator.next();
    state.ids.push(first.value?.id ?? 'missing');
  });
  try {
    await initialSent;
    await expect.poll(() => page.evaluate(() => window.agentBacklogRace.delivered)).toBe(100);
    appendBatch!();
    await expect.poll(() => page.evaluate(() => window.agentBacklogRace.delivered)).toBe(201);
    const result = await page.evaluate(async () => {
      const state = window.agentBacklogRace;
      for (let sequence = 2; sequence <= 150; sequence++) {
        const next = await state.iterator.next();
        state.ids.push(next.value?.id ?? 'missing');
      }
      // Fifty delivered unique events remain queued when cancellation occurs.
      state.controller.abort();
      const afterAbort = await state.iterator.next();
      return { ids: state.ids, done: afterAbort.done };
    });
    expect(result.ids).toEqual(Array.from({ length: 150 }, (_, index) => String(index + 1)));
    expect(result.done).toBe(true);
    await expect.poll(() => unsubscriptions).toBe(1);
  } finally {
    await page.evaluate(async () => {
      const state = window.agentBacklogRace;
      state.controller.abort();
      await state.iterator.return?.();
      window.WebSocket = state.original;
    });
  }
});

test('production Agent subscription drains a delivered backlog in order and releases on abort', async ({ page }) => {
  const count = 20_000;
  let subscriptions = 0;
  let unsubscriptions = 0;
  await page.routeWebSocket('**/ws/agent', (socket) => {
    socket.onMessage((data) => {
      const message = JSON.parse(String(data));
      if (message.type === 'unsubscribe') {
        unsubscriptions++;
        return;
      }
      if (message.type !== 'subscribe') return;
      subscriptions++;
      socket.send(JSON.stringify({ type: 'subscribed', requestId: message.requestId }));
      for (let sequence = 1; sequence <= count; sequence++) {
        socket.send(
          JSON.stringify({
            type: 'event',
            payload: {
              subscriptionId: message.payload.subscriptionId,
              durability: 'durable',
              sequence,
              eventType: 'summary.changed',
              schemaVersion: 1,
              payload: {},
            },
          }),
        );
      }
    });
  });
  await page.goto('/login');
  const samples = await page.evaluate(async (count) => {
    const modulePath = '/src/features/agent/api/agent-events.ts';
    const { agentEvents } = await import(/* @vite-ignore */ modulePath);
    const OriginalSocket = window.WebSocket;
    let delivered = 0;
    let resolveDelivered: (() => void) | undefined;
    const samples = [];
    class ObservedSocket extends OriginalSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        this.addEventListener('message', (event) => {
          if (JSON.parse(String(event.data)).type === 'event') {
            delivered++;
            if (delivered === count) resolveDelivered?.();
          }
        });
      }
    }
    window.WebSocket = ObservedSocket;
    try {
      for (let sample = 0; sample < 1; sample++) {
        delivered = 0;
        const allDelivered = new Promise<void>((resolve) => {
          resolveDelivered = resolve;
        });
        const controller = new AbortController();
        const iterator = agentEvents.host(0, controller.signal)[Symbol.asyncIterator]();
        try {
          const first = await iterator.next();
          await allDelivered;
          // Every frame is dispatched before the consumer resumes; no timer-based backlog assumption.
          await Promise.resolve();
          let ordered = !first.done && first.value.id === '1';
          for (let sequence = 2; sequence <= count; sequence++) {
            const next = await iterator.next();
            ordered &&= !next.done && next.value.id === String(sequence);
          }
          samples.push({ count, delivered, ordered });
        } finally {
          controller.abort();
          await iterator.return?.();
        }
      }
    } finally {
      window.WebSocket = OriginalSocket;
    }
    return samples;
  }, count);
  expect(samples).toHaveLength(1);
  expect(samples.every((sample) => sample.ordered && sample.delivered === count)).toBe(true);
  await expect.poll(() => unsubscriptions).toBe(1);
  expect(subscriptions).toBe(1);
});
