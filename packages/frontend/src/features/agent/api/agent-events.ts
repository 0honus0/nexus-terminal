import {
  AGENT_HOST_EVENT_TYPES,
  type AgentDurableEventTypeDto,
  type AgentTransientApprovalChangedPayloadDto,
  type AgentTransientMessageDeltaPayloadDto,
  type AgentTransientToolDeltaPayloadDto,
  type AgentWsSubscribeMessageDto,
  type AgentWsSubscriptionRequestDto,
  type AgentWsUnsubscribeMessageDto,
} from '@nexus-terminal/protocol/agent-events';
import type { AgentEnvelopeDto } from '@nexus-terminal/protocol/agent-common';
import type { AgentHostSummaryDto } from '@nexus-terminal/protocol/agent-host';
import { logger } from '@/client/logging/logger';
import { openWebSocket } from '@/client/websocket';
import type { AgentRunStatusDto } from './agent-api';
import { AgentApiError } from './agent-api-error';
import { agentHttpClient } from './agent-http-client';

interface AgentEventMetadata {
  id?: string;
  occurredAt?: number;
}

interface AgentVersionedEventMetadata extends AgentEventMetadata {
  schemaVersion: 1;
}

interface AgentMessageDeltaEvent extends AgentEventMetadata {
  type: 'message.delta';
  payload: AgentTransientMessageDeltaPayloadDto;
}

interface AgentToolDeltaEvent extends AgentEventMetadata {
  type: 'tool.delta';
  payload: AgentTransientToolDeltaPayloadDto;
}

interface AgentApprovalChangedEvent extends AgentEventMetadata {
  type: 'approval.changed';
  payload: AgentTransientApprovalChangedPayloadDto;
}

interface AgentModelRetryingEvent extends AgentVersionedEventMetadata {
  type: 'model.retrying';
  payload: {
    stepId: string;
    previousAttemptId: string;
    attemptId: string;
    attemptIndex: number;
    errorCode: string;
  };
}

interface AgentMessageFinalEvent extends AgentVersionedEventMetadata {
  type: 'message.final';
  payload: { text: string };
}

interface AgentRunStatusChangedEvent extends AgentVersionedEventMetadata {
  type: 'run.status_changed';
  payload: { from: AgentRunStatusDto; to: AgentRunStatusDto };
}

interface AgentRunErrorEvent extends AgentVersionedEventMetadata {
  type: 'run.error';
  payload: { code: string };
}

interface AgentRunCancelledEvent extends AgentVersionedEventMetadata {
  type: 'run.cancelled';
  payload: { reason: string };
}

interface AgentRunInterruptedEvent extends AgentVersionedEventMetadata {
  type: 'run.interrupted';
  payload: { reason: string; needsReconciliation?: boolean };
}

interface AgentRunCancelRequestedEvent extends AgentVersionedEventMetadata {
  type: 'run.cancel_requested';
  payload: { previousStatus: AgentRunStatusDto };
}

interface AgentRunRecoveryContinuedEvent extends AgentVersionedEventMetadata {
  type: 'run.recovery_continued';
  payload: {
    reason: 'backend_restart';
    checkpointId: string;
    continuedRunId: string;
  };
}

interface AgentRunRecoveryDeferredEvent extends AgentVersionedEventMetadata {
  type: 'run.recovery_deferred';
  payload: {
    reason: 'backend_restart';
    checkpointId: string;
    waitingFor: 'workspace_background_jobs';
    jobIds: string[];
  };
}

interface AgentRunRecoveryFailedEvent extends AgentVersionedEventMetadata {
  type: 'run.recovery_failed';
  payload: {
    reason: 'backend_restart';
    checkpointId: string | null;
    reasons: string[];
  };
}

const SNAPSHOT_EVENT_TYPES = [
  'approval.consumed',
  'approval.expired',
  'approval.requested',
  'approval.superseded',
  'budget.increase_requested',
  'budget.increased',
  'input.appended',
  'model.aborted',
  'model.completed',
  'model.failed',
  'model.started',
  'plan.updated',
  'subagent.cancelled',
  'subagent.started',
  'tool.failed',
  'tool.proposed',
  'tool.started',
  'verification.completed',
] as const satisfies readonly AgentDurableEventTypeDto[];
type AgentSnapshotEventType = (typeof SNAPSHOT_EVENT_TYPES)[number];

interface AgentSnapshotChangedEvent extends AgentVersionedEventMetadata {
  type: 'snapshot.changed';
  sourceType: AgentSnapshotEventType;
  payload: null;
}

type AgentHostEventType = (typeof AGENT_HOST_EVENT_TYPES)[number];

interface AgentHostChangedEvent extends AgentEventMetadata {
  type: 'host.changed';
  sourceType: AgentHostEventType;
  payload: Record<string, unknown>;
}

type AgentUnknownReason = 'invalid_payload' | 'unsupported_event' | 'unsupported_schema';

export interface AgentUnknownEvent extends AgentEventMetadata {
  type: 'unknown';
  sourceType: string;
  schemaVersion?: number;
  reason: AgentUnknownReason;
  payload: null;
}

interface AgentTransportDisconnectedEvent extends AgentEventMetadata {
  type: 'transport.disconnected';
  payload: null;
}

export type AgentStreamEvent =
  | AgentMessageDeltaEvent
  | AgentToolDeltaEvent
  | AgentApprovalChangedEvent
  | AgentModelRetryingEvent
  | AgentMessageFinalEvent
  | AgentRunStatusChangedEvent
  | AgentRunErrorEvent
  | AgentRunCancelledEvent
  | AgentRunInterruptedEvent
  | AgentRunCancelRequestedEvent
  | AgentRunRecoveryContinuedEvent
  | AgentRunRecoveryDeferredEvent
  | AgentRunRecoveryFailedEvent
  | AgentSnapshotChangedEvent
  | AgentHostChangedEvent
  | AgentUnknownEvent
  | AgentTransportDisconnectedEvent;

const subscriptionContext = (request: AgentWsSubscriptionRequestDto) =>
  request.channel === 'host'
    ? { channel: 'host' as const, cursor: request.cursor }
    : { channel: 'run' as const, appId: request.appId, runId: request.runId, cursor: request.cursor };

const RUN_STATUSES = new Set<AgentRunStatusDto>([
  'created',
  'running',
  'awaiting_approval',
  'awaiting_budget',
  'awaiting_input',
  'cancelling',
  'completed',
  'completed_unverified',
  'failed',
  'cancelled',
  'interrupted',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isRunStatus = (value: unknown): value is AgentRunStatusDto =>
  typeof value === 'string' && RUN_STATUSES.has(value as AgentRunStatusDto);

const protocolError = (value: unknown): Error => {
  if (!isRecord(value) || typeof value.code !== 'string') return new Error('AGENT_WS_PROTOCOL_ERROR');
  return new Error(value.code);
};

const parseWireMessage = (data: unknown): Record<string, unknown> => {
  if (typeof data !== 'string') throw new Error('AGENT_WS_BINARY_MESSAGE');
  const parsed = JSON.parse(data) as unknown;
  if (!isRecord(parsed) || typeof parsed.type !== 'string') throw new Error('AGENT_WS_PROTOCOL_ERROR');
  if (parsed.requestId !== undefined && typeof parsed.requestId !== 'string') {
    throw new Error('AGENT_WS_PROTOCOL_ERROR');
  }
  return parsed;
};

const eventMetadata = (event: Record<string, unknown>): AgentEventMetadata => ({
  ...(event.durability === 'durable' && Number.isSafeInteger(event.sequence) ? { id: String(event.sequence) } : {}),
  ...(Number.isSafeInteger(event.occurredAt) ? { occurredAt: Number(event.occurredAt) } : {}),
});

const unknownEvent = (
  event: Record<string, unknown>,
  channel: AgentWsSubscriptionRequestDto['channel'],
  reason: AgentUnknownReason,
): AgentUnknownEvent => {
  logger.debug(
    { channel, eventType: event.eventType, schemaVersion: event.schemaVersion, reason },
    'Agent event ignored by typed projector',
  );
  return {
    ...eventMetadata(event),
    type: 'unknown',
    sourceType: typeof event.eventType === 'string' ? event.eventType : 'unknown',
    ...(Number.isSafeInteger(event.schemaVersion) ? { schemaVersion: Number(event.schemaVersion) } : {}),
    reason,
    payload: null,
  };
};

const parseAttemptIdentity = (payload: Record<string, unknown>): { attemptId: string; attemptIndex: number } | null => {
  if (
    typeof payload.attemptId !== 'string' ||
    !Number.isSafeInteger(payload.attemptIndex) ||
    Number(payload.attemptIndex) < 1
  ) {
    return null;
  }
  return { attemptId: payload.attemptId, attemptIndex: Number(payload.attemptIndex) };
};

const parseRuntimeIdentity = (
  payload: Record<string, unknown>,
): { runtimeId?: string; delegationId?: string } | null => {
  const runtimeId = payload.runtimeId;
  const delegationId = payload.delegationId;
  if (runtimeId === undefined && delegationId === undefined) return {};
  if (typeof runtimeId !== 'string' || typeof delegationId !== 'string') return null;
  return { runtimeId, delegationId };
};

const parseMessageDelta = (event: Record<string, unknown>): AgentMessageDeltaEvent | null => {
  if (!isRecord(event.payload) || typeof event.payload.text !== 'string') return null;
  const attempt = parseAttemptIdentity(event.payload);
  const runtime = parseRuntimeIdentity(event.payload);
  if (!attempt || !runtime) return null;
  return {
    ...eventMetadata(event),
    type: 'message.delta',
    payload: {
      ...attempt,
      text: event.payload.text,
      ...runtime,
    },
  };
};

const nullableString = (value: unknown): value is string | null => value === null || typeof value === 'string';

const parseToolDelta = (event: Record<string, unknown>): AgentToolDeltaEvent | null => {
  if (
    !isRecord(event.payload) ||
    !Number.isSafeInteger(event.payload.index) ||
    Number(event.payload.index) < 0 ||
    !nullableString(event.payload.id) ||
    !nullableString(event.payload.name) ||
    typeof event.payload.argumentsDelta !== 'string'
  ) {
    return null;
  }
  const attempt = parseAttemptIdentity(event.payload);
  const runtime = parseRuntimeIdentity(event.payload);
  if (!attempt || !runtime) return null;
  return {
    ...eventMetadata(event),
    type: 'tool.delta',
    payload: {
      ...attempt,
      index: Number(event.payload.index),
      id: event.payload.id,
      name: event.payload.name,
      argumentsDelta: event.payload.argumentsDelta,
      ...runtime,
    },
  };
};

const parseRunEventV1 = (
  event: Record<string, unknown>,
  channel: AgentWsSubscriptionRequestDto['channel'],
): AgentStreamEvent => {
  const metadata = { ...eventMetadata(event), schemaVersion: 1 as const };
  if (event.eventType === 'message.final') {
    if (!isRecord(event.payload) || typeof event.payload.text !== 'string')
      return unknownEvent(event, channel, 'invalid_payload');
    return { ...metadata, type: 'message.final', payload: { text: event.payload.text } };
  }
  if (event.eventType === 'run.status_changed') {
    if (!isRecord(event.payload) || !isRunStatus(event.payload.from) || !isRunStatus(event.payload.to)) {
      return unknownEvent(event, channel, 'invalid_payload');
    }
    return { ...metadata, type: 'run.status_changed', payload: { from: event.payload.from, to: event.payload.to } };
  }
  if (event.eventType === 'run.error') {
    if (!isRecord(event.payload) || typeof event.payload.code !== 'string')
      return unknownEvent(event, channel, 'invalid_payload');
    return { ...metadata, type: 'run.error', payload: { code: event.payload.code } };
  }
  if (event.eventType === 'run.cancelled') {
    if (!isRecord(event.payload) || typeof event.payload.reason !== 'string')
      return unknownEvent(event, channel, 'invalid_payload');
    return { ...metadata, type: 'run.cancelled', payload: { reason: event.payload.reason } };
  }
  if (event.eventType === 'run.interrupted') {
    if (
      !isRecord(event.payload) ||
      typeof event.payload.reason !== 'string' ||
      (event.payload.needsReconciliation !== undefined && typeof event.payload.needsReconciliation !== 'boolean')
    ) {
      return unknownEvent(event, channel, 'invalid_payload');
    }
    return {
      ...metadata,
      type: 'run.interrupted',
      payload: {
        reason: event.payload.reason,
        ...(event.payload.needsReconciliation === undefined
          ? {}
          : { needsReconciliation: event.payload.needsReconciliation }),
      },
    };
  }
  if (event.eventType === 'run.cancel_requested') {
    if (!isRecord(event.payload) || !isRunStatus(event.payload.previousStatus)) {
      return unknownEvent(event, channel, 'invalid_payload');
    }
    return { ...metadata, type: 'run.cancel_requested', payload: { previousStatus: event.payload.previousStatus } };
  }
  if (event.eventType === 'run.recovery_continued') {
    if (
      !isRecord(event.payload) ||
      event.payload.reason !== 'backend_restart' ||
      typeof event.payload.checkpointId !== 'string' ||
      typeof event.payload.continuedRunId !== 'string'
    ) {
      return unknownEvent(event, channel, 'invalid_payload');
    }
    return {
      ...metadata,
      type: 'run.recovery_continued',
      payload: {
        reason: 'backend_restart',
        checkpointId: event.payload.checkpointId,
        continuedRunId: event.payload.continuedRunId,
      },
    };
  }
  if (event.eventType === 'run.recovery_deferred') {
    if (
      !isRecord(event.payload) ||
      event.payload.reason !== 'backend_restart' ||
      typeof event.payload.checkpointId !== 'string' ||
      event.payload.waitingFor !== 'workspace_background_jobs' ||
      !Array.isArray(event.payload.jobIds) ||
      event.payload.jobIds.some((jobId) => typeof jobId !== 'string')
    ) {
      return unknownEvent(event, channel, 'invalid_payload');
    }
    return {
      ...metadata,
      type: 'run.recovery_deferred',
      payload: {
        reason: 'backend_restart',
        checkpointId: event.payload.checkpointId,
        waitingFor: 'workspace_background_jobs',
        jobIds: [...event.payload.jobIds] as string[],
      },
    };
  }
  if (event.eventType === 'run.recovery_failed') {
    if (
      !isRecord(event.payload) ||
      event.payload.reason !== 'backend_restart' ||
      (event.payload.checkpointId !== null && typeof event.payload.checkpointId !== 'string') ||
      !Array.isArray(event.payload.reasons) ||
      event.payload.reasons.some((reason) => typeof reason !== 'string')
    ) {
      return unknownEvent(event, channel, 'invalid_payload');
    }
    return {
      ...metadata,
      type: 'run.recovery_failed',
      payload: {
        reason: 'backend_restart',
        checkpointId: event.payload.checkpointId,
        reasons: [...event.payload.reasons] as string[],
      },
    };
  }
  if (event.eventType === 'model.retrying') {
    if (
      !isRecord(event.payload) ||
      typeof event.payload.stepId !== 'string' ||
      typeof event.payload.previousAttemptId !== 'string' ||
      typeof event.payload.errorCode !== 'string'
    ) {
      return unknownEvent(event, channel, 'invalid_payload');
    }
    const attempt = parseAttemptIdentity(event.payload);
    if (!attempt) return unknownEvent(event, channel, 'invalid_payload');
    return {
      ...metadata,
      type: 'model.retrying',
      payload: {
        stepId: event.payload.stepId,
        previousAttemptId: event.payload.previousAttemptId,
        ...attempt,
        errorCode: event.payload.errorCode,
      },
    };
  }
  const snapshotEventType =
    typeof event.eventType === 'string'
      ? SNAPSHOT_EVENT_TYPES.find((candidate) => candidate === event.eventType)
      : undefined;
  if (snapshotEventType) {
    if (!isRecord(event.payload)) return unknownEvent(event, channel, 'invalid_payload');
    return {
      ...metadata,
      type: 'snapshot.changed',
      sourceType: snapshotEventType,
      payload: null,
    };
  }
  return unknownEvent(event, channel, 'unsupported_event');
};

const parseWireEvent = (
  payload: unknown,
  subscriptionId: string,
  channel: AgentWsSubscriptionRequestDto['channel'],
): AgentStreamEvent | null => {
  if (!isRecord(payload) || payload.subscriptionId !== subscriptionId) return null;
  const eventType = payload.eventType;
  if ((payload.durability !== 'durable' && payload.durability !== 'ephemeral') || typeof eventType !== 'string') {
    throw new Error('AGENT_WS_PROTOCOL_ERROR');
  }
  const event = payload;
  if (event.durability === 'durable' && (!Number.isSafeInteger(event.sequence) || Number(event.sequence) < 0)) {
    throw new Error('AGENT_WS_PROTOCOL_ERROR');
  }
  if (
    event.schemaVersion !== undefined &&
    (!Number.isSafeInteger(event.schemaVersion) || Number(event.schemaVersion) < 1)
  ) {
    throw new Error('AGENT_WS_PROTOCOL_ERROR');
  }
  if (event.occurredAt !== undefined && (!Number.isSafeInteger(event.occurredAt) || Number(event.occurredAt) < 0)) {
    throw new Error('AGENT_WS_PROTOCOL_ERROR');
  }

  if (channel === 'host') {
    if (event.durability !== 'durable') return unknownEvent(event, channel, 'unsupported_event');
    const hostEventType = AGENT_HOST_EVENT_TYPES.find((candidate) => candidate === eventType);
    if (!hostEventType || !isRecord(event.payload)) {
      return unknownEvent(event, channel, hostEventType ? 'invalid_payload' : 'unsupported_event');
    }
    return {
      ...eventMetadata(event),
      type: 'host.changed',
      sourceType: hostEventType,
      payload: event.payload,
    };
  }

  if (event.durability === 'ephemeral') {
    if (event.eventType === 'message.delta')
      return parseMessageDelta(event) ?? unknownEvent(event, channel, 'invalid_payload');
    if (event.eventType === 'tool.delta')
      return parseToolDelta(event) ?? unknownEvent(event, channel, 'invalid_payload');
    if (event.eventType === 'approval.changed') {
      if (!isRecord(event.payload) || typeof event.payload.approvalId !== 'string') {
        return unknownEvent(event, channel, 'invalid_payload');
      }
      return {
        ...eventMetadata(event),
        type: 'approval.changed',
        payload: { approvalId: event.payload.approvalId },
      };
    }
    return unknownEvent(event, channel, 'unsupported_event');
  }

  if (event.schemaVersion !== 1) return unknownEvent(event, channel, 'unsupported_schema');
  return parseRunEventV1(event, channel);
};

interface SharedAgentSocketState {
  socket: WebSocket;
  open: Promise<WebSocket>;
  leases: number;
}

interface SharedAgentSocketLease {
  socket: WebSocket;
  release(): void;
}

let sharedAgentSocket: SharedAgentSocketState | null = null;

const createSharedAgentSocket = (): SharedAgentSocketState => {
  const socket = openWebSocket('/ws/agent');
  let state: SharedAgentSocketState;
  const open = new Promise<WebSocket>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      socket.removeEventListener('open', onOpen);
      socket.removeEventListener('error', onError);
      socket.removeEventListener('close', onCloseBeforeOpen);
      if (error) reject(error);
      else resolve(socket);
    };
    const onOpen = (): void => finish();
    const onError = (): void => finish(new Error('AGENT_WS_OPEN_FAILED'));
    const onCloseBeforeOpen = (event: CloseEvent): void => finish(new Error(`AGENT_WS_OPEN_CLOSED_${event.code}`));
    socket.addEventListener('open', onOpen, { once: true });
    socket.addEventListener('error', onError, { once: true });
    socket.addEventListener('close', onCloseBeforeOpen, { once: true });
  });
  state = { socket, open, leases: 0 };
  socket.addEventListener(
    'close',
    () => {
      if (sharedAgentSocket === state) sharedAgentSocket = null;
    },
    { once: true },
  );
  sharedAgentSocket = state;
  logger.debug({}, 'Shared Agent event WebSocket opening');
  return state;
};

const acquireSharedAgentSocket = async (signal: AbortSignal): Promise<SharedAgentSocketLease> => {
  if (signal.aborted) throw new Error('ABORTED');
  let state = sharedAgentSocket;
  if (!state || state.socket.readyState === WebSocket.CLOSING || state.socket.readyState === WebSocket.CLOSED) {
    state = createSharedAgentSocket();
  }
  state.leases += 1;
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    state.leases = Math.max(0, state.leases - 1);
    if (state.leases !== 0 || sharedAgentSocket !== state) return;
    if (state.socket.readyState === WebSocket.CONNECTING || state.socket.readyState === WebSocket.OPEN) {
      state.socket.close(1000, 'Agent event subscribers released');
    }
  };

  let removeAbortListener = (): void => undefined;
  const aborted = new Promise<never>((_, reject) => {
    const onAbort = (): void => reject(new Error('ABORTED'));
    signal.addEventListener('abort', onAbort, { once: true });
    removeAbortListener = () => signal.removeEventListener('abort', onAbort);
  });
  try {
    const socket = await Promise.race([state.open, aborted]);
    removeAbortListener();
    if (signal.aborted) throw new Error('ABORTED');
    return { socket, release };
  } catch (cause) {
    removeAbortListener();
    release();
    throw cause;
  }
};

async function* connectOnce(
  request: AgentWsSubscriptionRequestDto,
  signal: AbortSignal,
  onSubscribed: () => void,
): AsyncIterable<AgentStreamEvent> {
  if (signal.aborted) return;

  const lease = await acquireSharedAgentSocket(signal);
  const socket = lease.socket;
  const subscriptionId = crypto.randomUUID();
  const log = subscriptionContext(request);
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
    rejectSubscribed?.(new Error('ABORTED'));
    notify();
  };
  const onMessage = (browserEvent: MessageEvent): void => {
    try {
      const message = parseWireMessage(browserEvent.data);
      if (message.type === 'subscribed' && message.requestId === requestId) {
        subscribed = true;
        logger.debug(log, 'Agent event subscription acknowledged');
        resolveSubscribed?.();
        return;
      }
      if (message.type === 'event') {
        const event = parseWireEvent(message.payload, subscriptionId, request.channel);
        if (!event) return;
        queue.push(event);
        notify();
        return;
      }
      if (message.type === 'error') {
        const payload = isRecord(message.payload) ? message.payload : {};
        const relevant =
          message.requestId === requestId ||
          payload.subscriptionId === subscriptionId ||
          (!message.requestId && !payload.subscriptionId);
        if (!relevant) return;
        terminalError = protocolError(payload);
        logger.warn({ ...log, err: terminalError }, 'Agent event subscription returned a protocol error');
        rejectSubscribed?.(terminalError);
        notify();
      }
    } catch (cause) {
      terminalError = cause instanceof Error ? cause : new Error('AGENT_WS_PROTOCOL_ERROR');
      logger.warn({ ...log, err: terminalError }, 'Agent event message processing failed');
      rejectSubscribed?.(terminalError);
      notify();
      if (socket.readyState === WebSocket.OPEN) socket.close(1002, 'Agent protocol error');
    }
  };
  const onClose = (event: CloseEvent): void => {
    if (!signal.aborted && !terminalError) terminalError = new Error(`AGENT_WS_CLOSED_${event.code}`);
    logger.debug(
      { ...log, closeCode: event.code, clean: event.wasClean, aborted: signal.aborted },
      'Shared Agent event WebSocket closed',
    );
    if (terminalError) rejectSubscribed?.(terminalError);
    notify();
  };
  signal.addEventListener('abort', abort, { once: true });
  socket.addEventListener('message', onMessage);
  socket.addEventListener('close', onClose);

  try {
    if (signal.aborted) return;
    const subscribedAck = new Promise<void>((resolve, reject) => {
      resolveSubscribed = resolve;
      rejectSubscribed = reject;
    });
    const subscribeMessage: AgentWsSubscribeMessageDto = {
      type: 'subscribe',
      requestId,
      payload: { subscriptionId, ...request },
    };
    socket.send(JSON.stringify(subscribeMessage));
    await subscribedAck;
    resolveSubscribed = undefined;
    rejectSubscribed = undefined;
    onSubscribed();

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
    socket.removeEventListener('message', onMessage);
    socket.removeEventListener('close', onClose);
    if (subscribed && socket.readyState === WebSocket.OPEN) {
      const unsubscribeMessage: AgentWsUnsubscribeMessageDto = {
        type: 'unsubscribe',
        payload: { subscriptionId },
      };
      socket.send(JSON.stringify(unsubscribeMessage));
    }
    lease.release();
  }
}

const RETRY_BASE_MS = 400;
const RETRY_MAX_MS = 8_000;

const requestWithCursor = (request: AgentWsSubscriptionRequestDto, cursor: number): AgentWsSubscriptionRequestDto =>
  request.channel === 'host'
    ? { channel: 'host', cursor }
    : { channel: 'run', appId: request.appId, runId: request.runId, cursor };

const durableSequence = (event: AgentStreamEvent): number | null => {
  if (event.id === undefined) return null;
  const sequence = Number(event.id);
  return Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : null;
};

const assertActiveSession = async (): Promise<void> => {
  try {
    await agentHttpClient.get('/agent/summary');
  } catch (cause) {
    if (cause instanceof AgentApiError && cause.status === 401) throw new Error('AGENT_WS_AUTH_REQUIRED');
  }
};

const hostResyncCursor = async (): Promise<number> => {
  const response = await agentHttpClient.get<AgentEnvelopeDto<AgentHostSummaryDto>>('/agent/summary');
  return response.data.data.eventCursor;
};

const retryableTransportError = (cause: unknown): boolean =>
  cause instanceof Error &&
  (cause.message === 'AGENT_WS_OPEN_FAILED' ||
    cause.message === 'AGENT_STREAM_FAILED' ||
    /^AGENT_WS_OPEN_CLOSED_\d+$/.test(cause.message) ||
    /^AGENT_WS_CLOSED_\d+$/.test(cause.message));

const needsSessionProbe = (cause: unknown): boolean =>
  cause instanceof Error &&
  (cause.message === 'AGENT_WS_OPEN_FAILED' || /^AGENT_WS_OPEN_CLOSED_\d+$/.test(cause.message));

const waitForReconnect = (attempt: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const exponent = Math.min(attempt, 6);
    const base = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** exponent);
    const delay = Math.min(RETRY_MAX_MS, base + Math.floor(base * 0.2 * Math.random()));
    const onAbort = (): void => {
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delay);
    signal.addEventListener('abort', onAbort, { once: true });
  });

async function* connect(request: AgentWsSubscriptionRequestDto, signal: AbortSignal): AsyncIterable<AgentStreamEvent> {
  let cursor = request.cursor;
  let retryAttempt = 0;

  while (!signal.aborted) {
    let sawEvent = false;
    try {
      for await (const event of connectOnce(requestWithCursor(request, cursor), signal, () => {
        retryAttempt = 0;
      })) {
        if (signal.aborted) return;
        if (event.type === 'unknown' && event.id !== undefined) {
          logger.warn(
            {
              ...subscriptionContext(request),
              cursor,
              eventId: event.id,
              sourceType: event.sourceType,
              schemaVersion: event.schemaVersion,
              reason: event.reason,
            },
            'Agent durable event rejected by typed projector',
          );
          throw new Error('AGENT_WS_DURABLE_EVENT_UNSUPPORTED');
        }
        const sequence = durableSequence(event);
        if (sequence !== null && sequence <= cursor) continue;
        sawEvent = true;
        yield event;
        if (sequence !== null) cursor = sequence;
      }
      if (signal.aborted) return;
    } catch (cause) {
      if (signal.aborted) return;
      if (request.channel === 'host' && cause instanceof Error && cause.message === 'CURSOR_EXPIRED') {
        const expiredCursor = cursor;
        try {
          cursor = await hostResyncCursor();
          retryAttempt = 0;
          logger.warn(
            { ...subscriptionContext(request), expiredCursor, resyncCursor: cursor },
            'Agent Host event cursor expired; resynchronized from current summary',
          );
          yield { type: 'transport.disconnected', payload: null };
          continue;
        } catch (resyncCause) {
          if (signal.aborted) return;
          if (resyncCause instanceof AgentApiError && resyncCause.status === 401) {
            throw new Error('AGENT_WS_AUTH_REQUIRED');
          }
          logger.warn(
            { ...subscriptionContext(request), expiredCursor, retryAttempt, err: resyncCause },
            'Agent Host event cursor resync failed; scheduling retry',
          );
          await waitForReconnect(retryAttempt, signal);
          retryAttempt += 1;
          continue;
        }
      }
      if (!retryableTransportError(cause)) {
        logger.warn({ ...subscriptionContext(request), cursor, err: cause }, 'Agent event stream failed permanently');
        throw cause;
      }
      logger.debug(
        { ...subscriptionContext(request), cursor, retryAttempt, err: cause },
        'Agent event stream disconnected; scheduling reconnect',
      );
      if (needsSessionProbe(cause)) await assertActiveSession();
    }

    if (sawEvent) yield { type: 'transport.disconnected', payload: null };
    await waitForReconnect(retryAttempt, signal);
    retryAttempt += 1;
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
