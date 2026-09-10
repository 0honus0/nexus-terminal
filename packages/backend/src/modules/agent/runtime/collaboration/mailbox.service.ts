import { randomUUID } from 'node:crypto';
import type { JsonValue, Scope, ClockPort } from '../../agent.types';
import type { AgentSettingsService } from '../../host/agent-settings.service';
import { requestHash, requireIdempotencyKey } from '../runs/idempotency';
import type { SubagentRepositoryPort } from './subagent.repository.port';
import type { AgentMessage, AgentMessageKind, MessageReceipt } from './subagent.types';

const MAX_PENDING_PER_RECIPIENT = 64;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_ENVELOPE_BYTES = 64 * 1024;
const MAX_TTL_SECONDS = 24 * 60 * 60;
const MAX_READ_MESSAGES = 64;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const nonEmpty = (value: unknown, maxBytes: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && Buffer.byteLength(value.trim(), 'utf8') <= maxBytes;
const jsonValue = (value: unknown): JsonValue => {
  let encoded: string;
  try {
    encoded = JSON.stringify(value ?? null);
  } catch {
    throw new Error('VALIDATION_FAILED');
  }
  return JSON.parse(encoded) as JsonValue;
};

interface ParsedMessage {
  recipientRuntimeId: string;
  delegationId: string;
  kind: AgentMessageKind;
  correlationId: string;
  replyTo: string | null;
  causationId: string | null;
  taskRevision: number;
  body: JsonValue;
  artifactRefs: string[];
  ttlSeconds: number;
}

const parseMessage = (raw: unknown): ParsedMessage => {
  if (!isRecord(raw)) throw new Error('VALIDATION_FAILED');
  const allowed = new Set([
    'recipientRuntimeId',
    'delegationId',
    'kind',
    'correlationId',
    'replyTo',
    'causationId',
    'taskRevision',
    'body',
    'artifactRefs',
    'ttlSeconds',
  ]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) throw new Error('VALIDATION_FAILED');
  if (!nonEmpty(raw.recipientRuntimeId, 128) || !nonEmpty(raw.delegationId, 128)) throw new Error('VALIDATION_FAILED');
  if (!['request', 'reply', 'progress', 'evidence', 'completion'].includes(String(raw.kind))) {
    throw new Error('VALIDATION_FAILED');
  }
  if (!nonEmpty(raw.correlationId, 128)) throw new Error('VALIDATION_FAILED');
  if (raw.replyTo !== null && !nonEmpty(raw.replyTo, 128)) throw new Error('VALIDATION_FAILED');
  if (raw.causationId !== null && !nonEmpty(raw.causationId, 128)) throw new Error('VALIDATION_FAILED');
  if (!Number.isSafeInteger(raw.taskRevision) || (raw.taskRevision as number) < 0) throw new Error('VALIDATION_FAILED');
  if (
    !Array.isArray(raw.artifactRefs) ||
    raw.artifactRefs.length > 64 ||
    !raw.artifactRefs.every((value) => nonEmpty(value, 256))
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  if (
    !Number.isSafeInteger(raw.ttlSeconds) ||
    (raw.ttlSeconds as number) < 1 ||
    (raw.ttlSeconds as number) > MAX_TTL_SECONDS
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  const body = jsonValue(raw.body);
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_BODY_BYTES) throw new Error('MESSAGE_TOO_LARGE');
  return {
    recipientRuntimeId: raw.recipientRuntimeId.trim(),
    delegationId: raw.delegationId.trim(),
    kind: raw.kind as AgentMessageKind,
    correlationId: raw.correlationId.trim(),
    replyTo: raw.replyTo === null ? null : (raw.replyTo as string).trim(),
    causationId: raw.causationId === null ? null : (raw.causationId as string).trim(),
    taskRevision: raw.taskRevision as number,
    body,
    artifactRefs: [...new Set((raw.artifactRefs as string[]).map((value) => value.trim()))],
    ttlSeconds: raw.ttlSeconds as number,
  };
};

export class MailboxService {
  constructor(
    private readonly repository: SubagentRepositoryPort,
    private readonly settings: AgentSettingsService,
    private readonly clock: ClockPort,
    private readonly onWorkAvailable: () => void = () => undefined,
  ) {}

  async send(
    scope: Scope,
    runId: string,
    senderRuntimeId: string,
    raw: unknown,
    idempotencyKey: string,
  ): Promise<MessageReceipt> {
    const key = requireIdempotencyKey(idempotencyKey);
    const message = parseMessage(raw);
    if (message.recipientRuntimeId === senderRuntimeId) throw new Error('MESSAGE_RECIPIENT_INVALID');
    const [sender, recipient, delegations, settings] = await Promise.all([
      this.repository.runtime(scope, runId, senderRuntimeId),
      this.repository.runtime(scope, runId, message.recipientRuntimeId),
      this.repository.listDelegations(scope, runId),
      this.settings.get(scope.userId),
    ]);
    if (!sender || !recipient) throw new Error('AGENT_RUNTIME_NOT_FOUND');
    const delegation = delegations.find((candidate) => candidate.id === message.delegationId);
    if (!delegation) throw new Error('DELEGATION_NOT_FOUND');
    this.assertPeerPolicy(senderRuntimeId, message.recipientRuntimeId, delegation.id, delegations);

    const now = this.clock.nowUnixSeconds();
    const id = randomUUID();
    const envelope: JsonValue = {
      schemaVersion: 1,
      runId,
      senderRuntimeId,
      recipientRuntimeId: message.recipientRuntimeId,
      delegationId: message.delegationId,
      kind: message.kind,
      correlationId: message.correlationId,
      replyTo: message.replyTo,
      causationId: message.causationId,
      taskRevision: message.taskRevision,
      body: message.body,
      artifactRefs: message.artifactRefs,
      ttlSeconds: message.ttlSeconds,
    };
    const encoded = JSON.stringify(envelope);
    const sizeBytes = Buffer.byteLength(encoded, 'utf8');
    if (sizeBytes > MAX_ENVELOPE_BYTES) throw new Error('MESSAGE_TOO_LARGE');
    const receipt = await this.repository.sendMessage({
      scope,
      id,
      runId,
      senderRuntimeId,
      recipientRuntimeId: message.recipientRuntimeId,
      delegationId: message.delegationId,
      kind: message.kind,
      idempotencyKey: key,
      payloadHash: requestHash(1, envelope),
      correlationId: message.correlationId,
      replyTo: message.replyTo,
      causationId: message.causationId,
      taskRevision: message.taskRevision,
      body: message.body,
      artifactRefs: message.artifactRefs,
      sizeBytes,
      expiresAt: now + message.ttlSeconds,
      now,
      maxPending: MAX_PENDING_PER_RECIPIENT,
      maxHardRunMessages: settings.hardLimits.maxSubagentMessagesPerRun,
      maxHardRunBytes: settings.hardLimits.maxSubagentMessageBytesPerRun,
    });
    this.onWorkAvailable();
    return receipt;
  }

  async read(scope: Scope, runId: string, runtimeId: string, after: number, limit: number): Promise<AgentMessage[]> {
    if (
      !Number.isSafeInteger(after) ||
      after < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > MAX_READ_MESSAGES
    ) {
      throw new Error('VALIDATION_FAILED');
    }
    return this.repository.readMessages(scope, runId, runtimeId, after, limit);
  }

  async consume(
    scope: Scope,
    runId: string,
    runtimeId: string,
    through: number,
    expectedConsumedSequence: number,
  ): Promise<number> {
    if (
      !Number.isSafeInteger(through) ||
      through < 0 ||
      !Number.isSafeInteger(expectedConsumedSequence) ||
      expectedConsumedSequence < 0
    ) {
      throw new Error('VALIDATION_FAILED');
    }
    return this.repository.consumeMessages(
      scope,
      runId,
      runtimeId,
      through,
      expectedConsumedSequence,
      this.clock.nowUnixSeconds(),
    );
  }

  async sweepExpired(limit = 256): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw new Error('VALIDATION_FAILED');
    return this.repository.expireMessages(this.clock.nowUnixSeconds(), limit);
  }

  private assertPeerPolicy(
    senderRuntimeId: string,
    recipientRuntimeId: string,
    delegationId: string,
    delegations: Awaited<ReturnType<SubagentRepositoryPort['listDelegations']>>,
  ): void {
    const subject = delegations.find((delegation) => delegation.id === delegationId);
    if (!subject) throw new Error('DELEGATION_NOT_FOUND');
    const direct =
      (subject.parentRuntimeId === senderRuntimeId && subject.childRuntimeId === recipientRuntimeId) ||
      (subject.childRuntimeId === senderRuntimeId && subject.parentRuntimeId === recipientRuntimeId);
    if (direct) return;
    const senderDelegation = delegations.find((delegation) => delegation.childRuntimeId === senderRuntimeId) ?? null;
    const recipientDelegation =
      delegations.find((delegation) => delegation.childRuntimeId === recipientRuntimeId) ?? null;
    if (
      senderDelegation &&
      recipientDelegation &&
      senderDelegation.peerMessaging === 'same-run' &&
      recipientDelegation.peerMessaging === 'same-run'
    ) {
      return;
    }
    throw new Error('MESSAGE_PEER_FORBIDDEN');
  }
}
