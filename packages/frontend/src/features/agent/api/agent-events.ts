import { openWebSocket } from '@/client/websocket';

export interface AgentStreamEvent<T = unknown> {
  id?: string;
  type: string;
  payload: T;
  occurredAt?: number;
}

type AgentSubscriptionRequest =
  { channel: 'host'; cursor: number } | { channel: 'run'; appId: string; runId: string; cursor: number };

interface AgentWireMessage {
  type: string;
  requestId?: string;
  payload?: unknown;
}

interface AgentWireEventPayload {
  subscriptionId: string;
  durability: 'durable' | 'ephemeral';
  sequence?: number;
  eventType: string;
  payload: unknown;
  occurredAt?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const protocolError = (value: unknown): Error => {
  if (!isRecord(value) || typeof value.code !== 'string') return new Error('AGENT_WS_PROTOCOL_ERROR');
  return new Error(value.code);
};

const parseWireMessage = (data: unknown): AgentWireMessage => {
  if (typeof data !== 'string') throw new Error('AGENT_WS_BINARY_MESSAGE');
  const parsed = JSON.parse(data) as unknown;
  if (!isRecord(parsed) || typeof parsed.type !== 'string') throw new Error('AGENT_WS_PROTOCOL_ERROR');
  if (parsed.requestId !== undefined && typeof parsed.requestId !== 'string')
    throw new Error('AGENT_WS_PROTOCOL_ERROR');
  return parsed as unknown as AgentWireMessage;
};

const parseWireEvent = (payload: unknown, subscriptionId: string): AgentStreamEvent | null => {
  if (!isRecord(payload) || payload.subscriptionId !== subscriptionId) return null;
  if (
    (payload.durability !== 'durable' && payload.durability !== 'ephemeral') ||
    typeof payload.eventType !== 'string'
  ) {
    throw new Error('AGENT_WS_PROTOCOL_ERROR');
  }
  const event = payload as unknown as AgentWireEventPayload;
  if (event.durability === 'durable' && (!Number.isSafeInteger(event.sequence) || Number(event.sequence) < 0)) {
    throw new Error('AGENT_WS_PROTOCOL_ERROR');
  }
  if (event.occurredAt !== undefined && (!Number.isSafeInteger(event.occurredAt) || Number(event.occurredAt) < 0)) {
    throw new Error('AGENT_WS_PROTOCOL_ERROR');
  }
  return {
    ...(event.durability === 'durable' ? { id: String(event.sequence) } : {}),
    type: event.eventType,
    payload: event.payload,
    ...(event.occurredAt === undefined ? {} : { occurredAt: event.occurredAt }),
  };
};

const waitForOpen = (socket: WebSocket, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      socket.removeEventListener('open', onOpen);
      socket.removeEventListener('error', onError);
      socket.removeEventListener('close', onClose);
      signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onOpen = (): void => finish();
    const onError = (): void => finish(new Error('AGENT_WS_OPEN_FAILED'));
    const onClose = (event: CloseEvent): void => finish(new Error(`AGENT_WS_CLOSED_${event.code}`));
    const onAbort = (): void => finish();
    socket.addEventListener('open', onOpen, { once: true });
    socket.addEventListener('error', onError, { once: true });
    socket.addEventListener('close', onClose, { once: true });
    signal.addEventListener('abort', onAbort, { once: true });
  });

async function* connect(request: AgentSubscriptionRequest, signal: AbortSignal): AsyncIterable<AgentStreamEvent> {
  if (signal.aborted) return;

  const socket = openWebSocket('/ws/agent');
  const subscriptionId = crypto.randomUUID();
  const requestId = crypto.randomUUID();
  const queue: AgentStreamEvent[] = [];
  let wake: (() => void) | null = null;
  let terminalError: Error | null = null;
  let subscribed = false;
  let resolveSubscribed: (() => void) | undefined;
  let rejectSubscribed: ((error: Error) => void) | undefined;

  const notify = (): void => {
    const current = wake;
    wake = null;
    current?.();
  };
  const abort = (): void => {
    if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
      socket.close(1000, 'Agent subscription aborted');
    }
    notify();
  };
  signal.addEventListener('abort', abort, { once: true });

  socket.addEventListener('message', (browserEvent) => {
    try {
      const message = parseWireMessage(browserEvent.data);
      if (message.type === 'subscribed' && message.requestId === requestId) {
        subscribed = true;
        resolveSubscribed?.();
        return;
      }
      if (message.type === 'event') {
        const event = parseWireEvent(message.payload, subscriptionId);
        if (!event) return;
        queue.push(event);
        notify();
        return;
      }
      if (message.type === 'error') {
        const payload = isRecord(message.payload) ? message.payload : {};
        const relevant =
          message.requestId === requestId || payload.subscriptionId === subscriptionId || !message.requestId;
        if (!relevant) return;
        terminalError = protocolError(payload);
        rejectSubscribed?.(terminalError);
        notify();
      }
    } catch (cause) {
      terminalError = cause instanceof Error ? cause : new Error('AGENT_WS_PROTOCOL_ERROR');
      rejectSubscribed?.(terminalError);
      notify();
      if (socket.readyState === WebSocket.OPEN) socket.close(1002, 'Agent protocol error');
    }
  });
  socket.addEventListener('close', (event) => {
    if (!signal.aborted && !terminalError) terminalError = new Error(`AGENT_WS_CLOSED_${event.code}`);
    if (terminalError) rejectSubscribed?.(terminalError);
    notify();
  });

  try {
    await waitForOpen(socket, signal);
    if (signal.aborted) return;
    const subscribedAck = new Promise<void>((resolve, reject) => {
      resolveSubscribed = resolve;
      rejectSubscribed = reject;
    });
    socket.send(
      JSON.stringify({
        type: 'subscribe',
        requestId,
        payload: { subscriptionId, ...request },
      }),
    );
    await subscribedAck;
    resolveSubscribed = undefined;
    rejectSubscribed = undefined;

    while (!signal.aborted) {
      while (queue.length > 0) yield queue.shift()!;
      if (terminalError) throw terminalError;
      if (socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) break;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  } finally {
    signal.removeEventListener('abort', abort);
    if (subscribed && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'unsubscribe', payload: { subscriptionId } }));
    }
    if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
      socket.close(1000, 'Agent subscription ended');
    }
  }
}

export const agentEvents = {
  host(cursor: number, signal: AbortSignal): AsyncIterable<AgentStreamEvent> {
    return connect({ channel: 'host', cursor }, signal);
  },
  run(appId: string, runId: string, cursor: number, signal: AbortSignal): AsyncIterable<AgentStreamEvent> {
    return connect({ channel: 'run', appId, runId, cursor }, signal);
  },
};
