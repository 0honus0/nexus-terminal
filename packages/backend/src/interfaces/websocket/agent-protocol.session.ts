import WebSocket, { type RawData } from 'ws';
import type { AgentEventFacade, AgentRunFacade } from '../../modules/agent/public';
import { logger } from '../../shared/logging/logger';

const MAX_INBOUND_MESSAGE_BYTES = 16 * 1024;
const MAX_OUTBOUND_MESSAGE_BYTES = 64 * 1024;
const MAX_BUFFERED_BYTES = 1024 * 1024;
const MAX_SUBSCRIPTIONS = 16;
const SAFE_SUBSCRIPTION_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_IDENTIFIER_LENGTH = 128;

interface AgentProtocolTelemetry {
  replayLag(lag: number): void;
  protocolError(code: string): void;
  slowConsumerClose(): void;
}

interface AgentProtocolDependencies {
  events: AgentEventFacade;
  runs: AgentRunFacade;
  telemetry?: AgentProtocolTelemetry;
}

interface AgentProtocolContext {
  userId: number;
}

type AgentSubscriptionTarget =
  | { kind: 'host' }
  | {
      kind: 'run';
      appId: string;
      runId: string;
    };

interface AgentSubscription {
  id: string;
  target: AgentSubscriptionTarget;
  cursor: number;
  draining: boolean;
  drainRequested: boolean;
  closed: boolean;
  unsubscribeWake: () => void;
  unsubscribeTransient?: () => void;
}

interface AgentInboundMessage {
  type: 'subscribe' | 'unsubscribe';
  requestId?: string;
  payload: Record<string, unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const rawDataToBuffer = (data: RawData): Buffer => {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
};

const nonNegativeInteger = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;

const boundedIdentifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_IDENTIFIER_LENGTH;

const protocolErrorCode = (cause: unknown): string => {
  if (!(cause instanceof Error)) return 'AGENT_STREAM_FAILED';
  return /^[A-Z0-9_]+$/.test(cause.message) ? cause.message : 'AGENT_STREAM_FAILED';
};

/** Browser-only Agent event channel. Durable replay remains backed by Agent repositories; deltas stay ephemeral. */
export class AgentProtocolSession {
  private readonly subscriptions = new Map<string, AgentSubscription>();
  private closed = false;

  constructor(
    private readonly socket: WebSocket,
    private readonly context: AgentProtocolContext,
    private readonly dependencies: AgentProtocolDependencies,
  ) {}

  async handleMessage(data: RawData, isBinary: boolean): Promise<void> {
    if (this.closed) return;
    if (isBinary) {
      this.socket.close(1003, 'Agent protocol accepts text messages only');
      return;
    }
    const bytes = rawDataToBuffer(data);
    if (bytes.byteLength > MAX_INBOUND_MESSAGE_BYTES) {
      this.socket.close(1009, 'Agent protocol message too large');
      return;
    }

    let message: AgentInboundMessage;
    try {
      const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
      if (!isRecord(parsed) || (parsed.type !== 'subscribe' && parsed.type !== 'unsubscribe')) {
        throw new Error('VALIDATION_FAILED');
      }
      if (parsed.requestId !== undefined && !boundedIdentifier(parsed.requestId)) throw new Error('VALIDATION_FAILED');
      if (!isRecord(parsed.payload)) throw new Error('VALIDATION_FAILED');
      message = parsed as unknown as AgentInboundMessage;
    } catch (cause) {
      this.sendError(undefined, protocolErrorCode(cause));
      return;
    }

    try {
      if (message.type === 'subscribe') await this.subscribe(message.requestId, message.payload);
      else this.unsubscribe(message.requestId, message.payload);
    } catch (cause) {
      const code = protocolErrorCode(cause);
      if (code === 'AGENT_STREAM_FAILED') logger.error({ err: cause }, 'Agent WebSocket request failed');
      this.sendError(message.requestId, code);
    }
  }

  subscriptionCount(): number {
    return this.subscriptions.size;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const subscription of this.subscriptions.values()) this.disposeSubscription(subscription);
    this.subscriptions.clear();
  }

  private async subscribe(requestId: string | undefined, payload: Record<string, unknown>): Promise<void> {
    const subscriptionId = payload.subscriptionId;
    const channel = payload.channel;
    const cursor = payload.cursor;
    if (
      typeof subscriptionId !== 'string' ||
      !SAFE_SUBSCRIPTION_ID.test(subscriptionId) ||
      !nonNegativeInteger(cursor)
    ) {
      throw new Error('VALIDATION_FAILED');
    }
    if (channel !== 'host' && channel !== 'run') throw new Error('VALIDATION_FAILED');
    if (this.subscriptions.has(subscriptionId)) throw new Error('SUBSCRIPTION_EXISTS');
    if (this.subscriptions.size >= MAX_SUBSCRIPTIONS) throw new Error('SUBSCRIPTION_LIMIT');

    let target: AgentSubscriptionTarget;
    let highWater: number;
    if (channel === 'host') {
      target = { kind: 'host' };
      highWater = await this.dependencies.events.hostCursor(this.context.userId);
    } else {
      const appId = payload.appId;
      const runId = payload.runId;
      if (!boundedIdentifier(appId) || !boundedIdentifier(runId)) throw new Error('VALIDATION_FAILED');
      const snapshot = await this.dependencies.runs.get({ userId: this.context.userId, appId }, runId);
      target = { kind: 'run', appId, runId };
      highWater = snapshot.eventCursor;
    }
    if (cursor > highWater) throw new Error('CURSOR_AHEAD');
    this.dependencies.telemetry?.replayLag(highWater - cursor);

    const subscription: AgentSubscription = {
      id: subscriptionId,
      target,
      cursor,
      draining: false,
      drainRequested: false,
      closed: false,
      unsubscribeWake: () => undefined,
    };
    if (target.kind === 'host') {
      subscription.unsubscribeWake = this.dependencies.events.onHostWake(this.context.userId, () =>
        this.scheduleDrain(subscription),
      );
    } else {
      subscription.unsubscribeWake = this.dependencies.events.onRunWake(target.runId, () =>
        this.scheduleDrain(subscription),
      );
      subscription.unsubscribeTransient = this.dependencies.events.onTransient(target.runId, (event) => {
        if (subscription.closed || this.closed) return;
        this.send({
          type: 'event',
          payload: {
            subscriptionId: subscription.id,
            durability: 'ephemeral',
            eventType: event.type,
            payload: event.payload,
            occurredAt: event.occurredAt,
          },
        });
      });
    }
    this.subscriptions.set(subscriptionId, subscription);
    this.send({
      type: 'subscribed',
      ...(requestId ? { requestId } : {}),
      payload: { subscriptionId, channel, cursor, highWater },
    });
    this.scheduleDrain(subscription);
  }

  private unsubscribe(requestId: string | undefined, payload: Record<string, unknown>): void {
    const subscriptionId = payload.subscriptionId;
    if (typeof subscriptionId !== 'string' || !SAFE_SUBSCRIPTION_ID.test(subscriptionId)) {
      throw new Error('VALIDATION_FAILED');
    }
    const subscription = this.subscriptions.get(subscriptionId);
    if (subscription) {
      this.disposeSubscription(subscription);
      this.subscriptions.delete(subscriptionId);
    }
    this.send({
      type: 'unsubscribed',
      ...(requestId ? { requestId } : {}),
      payload: { subscriptionId },
    });
  }

  private scheduleDrain(subscription: AgentSubscription): void {
    if (this.closed || subscription.closed) return;
    subscription.drainRequested = true;
    if (!subscription.draining) void this.drain(subscription);
  }

  private async drain(subscription: AgentSubscription): Promise<void> {
    if (subscription.draining || subscription.closed || this.closed) return;
    subscription.draining = true;
    try {
      while (!subscription.closed && !this.closed && subscription.drainRequested) {
        subscription.drainRequested = false;
        while (!subscription.closed && !this.closed) {
          const page =
            subscription.target.kind === 'host'
              ? await this.dependencies.events.readHost(this.context.userId, subscription.cursor, 100)
              : await this.dependencies.events.readRun(
                  { userId: this.context.userId, appId: subscription.target.appId },
                  subscription.target.runId,
                  subscription.cursor,
                  100,
                );
          if (page.length === 0) break;
          for (const event of page) {
            if (subscription.closed || this.closed) return;
            const sent = this.send({
              type: 'event',
              payload: {
                subscriptionId: subscription.id,
                durability: 'durable',
                sequence: event.sequence,
                eventType: event.type,
                payload: event.payload,
                occurredAt: event.occurredAt,
                ...('schemaVersion' in event ? { schemaVersion: event.schemaVersion } : {}),
              },
            });
            if (!sent) return;
            subscription.cursor = event.sequence;
          }
          if (page.length < 100) break;
        }
      }
    } catch (cause) {
      const code = protocolErrorCode(cause);
      if (code === 'AGENT_STREAM_FAILED') {
        logger.error({ err: cause, subscriptionId: subscription.id }, 'Agent WebSocket replay failed');
      }
      this.sendError(undefined, code, subscription.id);
      this.disposeSubscription(subscription);
      this.subscriptions.delete(subscription.id);
    } finally {
      subscription.draining = false;
      if (!subscription.closed && !this.closed && subscription.drainRequested) this.scheduleDrain(subscription);
    }
  }

  private disposeSubscription(subscription: AgentSubscription): void {
    if (subscription.closed) return;
    subscription.closed = true;
    subscription.unsubscribeWake();
    subscription.unsubscribeTransient?.();
  }

  private sendError(requestId: string | undefined, code: string, subscriptionId?: string): void {
    this.dependencies.telemetry?.protocolError(code);
    this.send({
      type: 'error',
      ...(requestId ? { requestId } : {}),
      payload: { code, ...(subscriptionId ? { subscriptionId } : {}) },
    });
  }

  private send(message: Record<string, unknown>): boolean {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) return false;
    let encoded: string;
    try {
      encoded = JSON.stringify(message);
    } catch (cause) {
      logger.error({ err: cause }, 'Unable to serialize Agent WebSocket message');
      this.socket.close(1011, 'Agent protocol serialization failed');
      return false;
    }
    const bytes = Buffer.byteLength(encoded, 'utf8');
    if (bytes > MAX_OUTBOUND_MESSAGE_BYTES) {
      this.socket.close(1009, 'Agent protocol event too large');
      return false;
    }
    if (this.socket.bufferedAmount >= MAX_BUFFERED_BYTES) {
      this.dependencies.telemetry?.slowConsumerClose();
      this.socket.close(1013, 'Agent protocol client is too slow');
      return false;
    }
    this.socket.send(encoded, (error) => {
      if (!error) return;
      logger.debug({ err: error }, 'Agent WebSocket send failed');
      if (this.socket.readyState === WebSocket.OPEN) this.socket.close(1011, 'Agent protocol send failed');
    });
    return true;
  }
}
