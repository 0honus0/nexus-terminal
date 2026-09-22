import type { AgentJsonValueDto } from './agent-common.js';

export const AGENT_DURABLE_EVENT_TYPES = [
  'approval.approved',
  'approval.consumed',
  'approval.denied',
  'approval.expired',
  'approval.requested',
  'approval.superseded',
  'budget.increase_requested',
  'budget.increased',
  'completion.gate_blocked',
  'goal.updated',
  'input.appended',
  'input.pending_moved',
  'input.pending_removed',
  'input.request_answered',
  'input.request_cancelled',
  'input.requested',
  'message.final',
  'model.aborted',
  'model.completed',
  'model.failed',
  'model.retrying',
  'model.route_changed',
  'model.started',
  'plan.updated',
  'run.cancel_requested',
  'run.cancelled',
  'run.created',
  'run.error',
  'run.interrupted',
  'run.loop_detected',
  'run.loop_resumed',
  'run.loop_warning',
  'run.reconciliation_required',
  'run.reconciliation_resolved',
  'run.recovery_continued',
  'run.recovery_deferred',
  'run.recovery_failed',
  'run.status_changed',
  'subagent.cancelled',
  'subagent.completed',
  'subagent.created',
  'subagent.failed',
  'subagent.join_waiting',
  'subagent.message_accepted',
  'subagent.message_waiting',
  'subagent.started',
  'tool.cancelled',
  'tool.completed',
  'tool.failed',
  'tool.proposed',
  'tool.reconciliation_required',
  'tool.reinspected',
  'tool.started',
  'verification.completed',
] as const;

export type AgentDurableEventTypeDto = (typeof AGENT_DURABLE_EVENT_TYPES)[number];

export const AGENT_HOST_EVENT_TYPES = [
  'summary.changed',
  'feature.changed',
  'app.changed',
  'authorization.changed',
  'thread.changed',
  'memory.changed',
] as const;

export type AgentHostEventTypeDto = (typeof AGENT_HOST_EVENT_TYPES)[number];

export const AGENT_EPHEMERAL_RUN_EVENT_TYPES = ['message.delta', 'tool.delta', 'approval.changed'] as const;

export type AgentEphemeralRunEventTypeDto = (typeof AGENT_EPHEMERAL_RUN_EVENT_TYPES)[number];

export interface AgentModelAttemptIdentityDto {
  attemptId: string;
  attemptIndex: number;
}

export interface AgentTransientMessageDeltaPayloadDto extends AgentModelAttemptIdentityDto {
  text: string;
  runtimeId?: string;
  delegationId?: string;
}

export interface AgentTransientToolDeltaPayloadDto extends AgentModelAttemptIdentityDto {
  index: number;
  id: string | null;
  name: string | null;
  argumentsDelta: string;
  runtimeId?: string;
  delegationId?: string;
}

export interface AgentTransientApprovalChangedPayloadDto {
  approvalId: string;
}

export type AgentWsSubscriptionRequestDto =
  | { channel: 'host'; cursor: number }
  | { channel: 'run'; appId: string; runId: string; cursor: number };

export type AgentWsSubscribePayloadDto =
  | ({ subscriptionId: string } & Extract<AgentWsSubscriptionRequestDto, { channel: 'host' }>)
  | ({ subscriptionId: string } & Extract<AgentWsSubscriptionRequestDto, { channel: 'run' }>);

export interface AgentWsSubscribeMessageDto {
  type: 'subscribe';
  requestId?: string;
  payload: AgentWsSubscribePayloadDto;
}

export interface AgentWsUnsubscribeMessageDto {
  type: 'unsubscribe';
  requestId?: string;
  payload: { subscriptionId: string };
}

export type AgentWsClientMessageDto = AgentWsSubscribeMessageDto | AgentWsUnsubscribeMessageDto;

export interface AgentWsSubscribedMessageDto {
  type: 'subscribed';
  requestId?: string;
  payload: {
    subscriptionId: string;
    channel: 'host' | 'run';
    cursor: number;
    highWater: number;
  };
}

export interface AgentWsUnsubscribedMessageDto {
  type: 'unsubscribed';
  requestId?: string;
  payload: { subscriptionId: string };
}

export interface AgentWsErrorMessageDto {
  type: 'error';
  requestId?: string;
  payload: { code: string; subscriptionId?: string };
}

export interface AgentWsDurableEventPayloadDto {
  subscriptionId: string;
  durability: 'durable';
  sequence: number;
  schemaVersion?: 1;
  eventType: AgentDurableEventTypeDto | AgentHostEventTypeDto;
  payload: AgentJsonValueDto;
  occurredAt: number;
}

export type AgentWsEphemeralEventPayloadDto =
  | {
      subscriptionId: string;
      durability: 'ephemeral';
      eventType: 'message.delta';
      payload: AgentTransientMessageDeltaPayloadDto;
      occurredAt: number;
    }
  | {
      subscriptionId: string;
      durability: 'ephemeral';
      eventType: 'tool.delta';
      payload: AgentTransientToolDeltaPayloadDto;
      occurredAt: number;
    }
  | {
      subscriptionId: string;
      durability: 'ephemeral';
      eventType: 'approval.changed';
      payload: AgentTransientApprovalChangedPayloadDto;
      occurredAt: number;
    };

export type AgentWsEventPayloadDto = AgentWsDurableEventPayloadDto | AgentWsEphemeralEventPayloadDto;

export interface AgentWsEventMessageDto {
  type: 'event';
  payload: AgentWsEventPayloadDto;
}

export type AgentWsServerMessageDto =
  | AgentWsSubscribedMessageDto
  | AgentWsUnsubscribedMessageDto
  | AgentWsErrorMessageDto
  | AgentWsEventMessageDto;
