import { logger } from '../../shared/logging/logger';
import type { JsonValue, Scope } from '../../modules/agent/agent.types';
import type { ConversationRepositoryPort } from '../../modules/agent/ai/conversation.repository.port';
import type { RunEvent, RunView } from '../../modules/agent/runtime/runs/run.types';
import type { NotificationEvent } from '../../modules/notifications/notification.types';

export interface AgentNotificationPublisher {
  publish(event: NotificationEvent, details?: Record<string, unknown> | string): Promise<void>;
}

type NotificationProjection = {
  event: NotificationEvent;
  trigger: RunEvent;
  details: Record<string, unknown>;
};

const MAX_SEEN_EVENTS = 4_096;

const record = (value: JsonValue): Record<string, JsonValue> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, JsonValue>) : null;

const boundedString = (value: JsonValue | undefined, max = 256): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value.slice(0, max) : undefined;

const safeInteger = (value: JsonValue | undefined): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;

const statusTarget = (event: RunEvent): string | undefined => {
  if (event.type !== 'run.status_changed') return undefined;
  return boundedString(record(event.payload)?.to, 64);
};

const eventOfType = (events: readonly RunEvent[], type: string): RunEvent | undefined =>
  events.find((event) => event.type === type);

const eventChangingTo = (events: readonly RunEvent[], status: string): RunEvent | undefined =>
  events.find((event) => statusTarget(event) === status);

const terminalIssueDetails = (events: readonly RunEvent[]): Record<string, unknown> => {
  const error = eventOfType(events, 'run.error');
  const failed = eventOfType(events, 'model.failed');
  const interrupted = eventOfType(events, 'run.interrupted');
  const errorPayload = error ? record(error.payload) : null;
  const failedPayload = failed ? record(failed.payload) : null;
  const interruptedPayload = interrupted ? record(interrupted.payload) : null;
  const errorCode =
    boundedString(errorPayload?.code, 128) ??
    boundedString(failedPayload?.errorCode, 128) ??
    boundedString(interruptedPayload?.errorCode, 128);
  const reason = boundedString(interruptedPayload?.reason, 256);
  return {
    ...(errorCode ? { errorCode } : {}),
    ...(reason ? { reason } : {}),
  };
};

const projectionsFor = (events: readonly RunEvent[]): NotificationProjection[] => {
  const projections: NotificationProjection[] = [];

  const approval = eventOfType(events, 'approval.requested');
  if (approval) {
    const payload = record(approval.payload);
    projections.push({
      event: 'AGENT_APPROVAL_REQUIRED',
      trigger: approval,
      details: {
        attentionKind: 'approval',
        ...(() => {
          const approvalId = boundedString(payload?.approvalId, 128);
          const risk = boundedString(payload?.risk, 32);
          const expiresAt = safeInteger(payload?.expiresAt);
          return {
            ...(approvalId ? { approvalId } : {}),
            ...(risk ? { risk } : {}),
            ...(expiresAt !== undefined ? { expiresAt } : {}),
          };
        })(),
      },
    });
  }

  const input = eventOfType(events, 'input.requested');
  if (input) {
    const payload = record(input.payload);
    projections.push({
      event: 'AGENT_INPUT_REQUIRED',
      trigger: input,
      details: {
        attentionKind: 'input',
        ...(() => {
          const requestId = boundedString(payload?.requestId, 128);
          const questionCount = safeInteger(payload?.questionCount);
          return {
            ...(requestId ? { requestId } : {}),
            ...(questionCount !== undefined ? { questionCount } : {}),
          };
        })(),
      },
    });
  }

  const loop = eventOfType(events, 'run.loop_detected');
  const executionLimit = eventOfType(events, 'budget.increase_requested');
  const awaitingInput = eventChangingTo(events, 'awaiting_input');
  const awaitingBudget = eventChangingTo(events, 'awaiting_budget');
  if (!input && (loop || awaitingInput)) {
    const trigger = loop ?? awaitingInput!;
    const payload = record(trigger.payload);
    projections.push({
      event: 'AGENT_ATTENTION_REQUIRED',
      trigger,
      details: {
        attentionKind: 'execution_attention',
        ...(boundedString(payload?.reason, 256) ? { reason: boundedString(payload?.reason, 256) } : {}),
      },
    });
  }
  if (executionLimit || awaitingBudget) {
    const trigger = executionLimit ?? awaitingBudget!;
    const payload = record(trigger.payload);
    projections.push({
      event: 'AGENT_ATTENTION_REQUIRED',
      trigger,
      details: {
        attentionKind: 'execution_limit',
        ...(boundedString(payload?.reason, 256) ? { reason: boundedString(payload?.reason, 256) } : {}),
      },
    });
  }

  const completed = eventChangingTo(events, 'completed') ?? eventChangingTo(events, 'completed_unverified');
  if (completed) {
    projections.push({ event: 'AGENT_RUN_COMPLETED', trigger: completed, details: {} });
  }
  const failed = eventChangingTo(events, 'failed');
  if (failed) {
    projections.push({ event: 'AGENT_RUN_FAILED', trigger: failed, details: terminalIssueDetails(events) });
  }
  const interrupted = eventChangingTo(events, 'interrupted');
  if (interrupted) {
    projections.push({ event: 'AGENT_RUN_INTERRUPTED', trigger: interrupted, details: terminalIssueDetails(events) });
  }

  return projections;
};

export class AgentNotificationBridge {
  private readonly seenEventIds = new Set<string>();
  private readonly seenOrder: string[] = [];

  constructor(
    private readonly notifications: AgentNotificationPublisher,
    private readonly conversations: Pick<ConversationRepositoryPort, 'getThread'>,
  ) {}

  async project(run: RunView, events: readonly RunEvent[]): Promise<void> {
    if (events.length === 0) return;
    const pending = projectionsFor(events).filter((projection) => !this.seenEventIds.has(projection.trigger.eventId));
    if (pending.length === 0) return;

    const scope: Scope = { userId: run.userId, appId: run.appId };
    const thread = await this.conversations.getThread(scope, run.threadId).catch(() => null);
    const common: Record<string, unknown> = {
      appId: run.appId.slice(0, 256),
      runId: run.id.slice(0, 128),
      threadId: run.threadId.slice(0, 128),
      status: run.status,
      ...(thread?.title ? { threadTitle: thread.title.slice(0, 200) } : {}),
    };

    for (const projection of pending) this.remember(projection.trigger.eventId);
    const results = await Promise.allSettled(
      pending.map((projection) =>
        this.notifications.publish(projection.event, {
          ...common,
          ...projection.details,
          eventId: projection.trigger.eventId.slice(0, 128),
          eventSequence: projection.trigger.sequence,
          occurredAt: projection.trigger.occurredAt,
        }),
      ),
    );
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      if (result?.status !== 'rejected') continue;
      logger.warn(
        {
          err: result.reason,
          notificationEvent: pending[index]?.event,
          runId: run.id,
          appId: run.appId,
        },
        'Agent lifecycle notification projection failed',
      );
    }
  }

  private remember(eventId: string): void {
    if (this.seenEventIds.has(eventId)) return;
    this.seenEventIds.add(eventId);
    this.seenOrder.push(eventId);
    while (this.seenOrder.length > MAX_SEEN_EVENTS) {
      const oldest = this.seenOrder.shift();
      if (oldest) this.seenEventIds.delete(oldest);
    }
  }
}
