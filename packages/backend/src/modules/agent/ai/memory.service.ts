import { randomUUID } from 'node:crypto';
import type { AuditLogService } from '../../audit/audit.service';
import type { ClockPort, JsonValue, Scope } from '../agent.types';
import type { AppRegistryService } from '../host/app-registry.service';
import type { MemoryProvenancePort } from './memory-provenance.port';
import type {
  MemoryImportConfirmation,
  MemoryRepositoryPort,
  MemoryReviewAction,
  MemoryStatus,
  MemoryView,
} from './memory.repository.port';

const MAX_CONTENT_BYTES = 16 * 1024;
const MAX_SOURCE_REFS_BYTES = 32 * 1024;
const MAX_LIST = 200;
const IMPORT_CONFIRMATION_TTL_SECONDS = 10 * 60;
const IMPORT_INTENT = 'memory.import';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const nonEmpty = (value: unknown, maxBytes: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && Buffer.byteLength(value.trim(), 'utf8') <= maxBytes;
const jsonValue = (value: unknown, maxBytes: number): JsonValue => {
  let encoded: string;
  try {
    encoded = JSON.stringify(value ?? null);
  } catch {
    throw new Error('VALIDATION_FAILED');
  }
  if (Buffer.byteLength(encoded, 'utf8') > maxBytes) throw new Error('MEMORY_SOURCE_REFS_TOO_LARGE');
  return JSON.parse(encoded) as JsonValue;
};

interface ParsedProposal {
  content: string;
  sourceRefs: JsonValue;
  confidence: number;
  expiresAt: number | null;
}

const parseProposal = (raw: unknown, now: number): ParsedProposal => {
  if (!isRecord(raw)) throw new Error('VALIDATION_FAILED');
  const allowed = new Set(['content', 'sourceRefs', 'confidence', 'expiresAt']);
  if (Object.keys(raw).some((key) => !allowed.has(key))) throw new Error('VALIDATION_FAILED');
  if (!nonEmpty(raw.content, MAX_CONTENT_BYTES)) throw new Error('VALIDATION_FAILED');
  if (
    typeof raw.confidence !== 'number' ||
    !Number.isFinite(raw.confidence) ||
    raw.confidence < 0 ||
    raw.confidence > 1
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  if (raw.expiresAt !== null && (!Number.isSafeInteger(raw.expiresAt) || (raw.expiresAt as number) <= now)) {
    throw new Error('VALIDATION_FAILED');
  }
  return {
    content: raw.content.trim(),
    sourceRefs: jsonValue(raw.sourceRefs, MAX_SOURCE_REFS_BYTES),
    confidence: raw.confidence,
    expiresAt: raw.expiresAt as number | null,
  };
};

const parseReview = (raw: unknown): { decision: MemoryReviewAction; expectedVersion: number; content?: string } => {
  if (!isRecord(raw)) throw new Error('VALIDATION_FAILED');
  const allowed = new Set(['decision', 'expectedVersion', 'content']);
  if (Object.keys(raw).some((key) => !allowed.has(key))) throw new Error('VALIDATION_FAILED');
  if (!['publish', 'reject', 'revoke'].includes(String(raw.decision))) throw new Error('VALIDATION_FAILED');
  if (!Number.isSafeInteger(raw.expectedVersion) || (raw.expectedVersion as number) < 1)
    throw new Error('VALIDATION_FAILED');
  if (raw.content !== undefined && !nonEmpty(raw.content, MAX_CONTENT_BYTES)) throw new Error('VALIDATION_FAILED');
  return {
    decision: raw.decision as MemoryReviewAction,
    expectedVersion: raw.expectedVersion as number,
    ...(raw.content === undefined ? {} : { content: (raw.content as string).trim() }),
  };
};

export class MemoryService {
  constructor(
    private readonly repository: MemoryRepositoryPort,
    private readonly registry: AppRegistryService,
    private readonly provenance: MemoryProvenancePort,
    private readonly audit: AuditLogService,
    private readonly clock: ClockPort,
  ) {}

  async propose(scope: Scope, raw: unknown, provenance?: { runId: string; runtimeId: string }): Promise<MemoryView> {
    const now = this.clock.nowUnixSeconds();
    const proposal = parseProposal(raw, now);
    if (provenance) {
      await this.provenance.assertRuntime(scope, provenance.runId, provenance.runtimeId);
    }
    const memory = await this.repository.propose({
      id: randomUUID(),
      scope,
      ...proposal,
      proposedByRuntimeId: provenance?.runtimeId ?? null,
      now,
    });
    await this.audit
      .logAction('AGENT_MEMORY_PROPOSED', {
        userId: scope.userId,
        appId: scope.appId,
        memoryId: memory.id,
        proposedByRuntimeId: provenance?.runtimeId ?? null,
      })
      .catch(() => undefined);
    return memory;
  }

  async list(scope: Scope, status: MemoryStatus | 'all' = 'all', limit = 100): Promise<MemoryView[]> {
    if (!['candidate', 'published', 'revoked', 'all'].includes(status)) throw new Error('VALIDATION_FAILED');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIST) throw new Error('VALIDATION_FAILED');
    return this.repository.list(scope, status, limit);
  }

  async review(scope: Scope, memoryId: string, raw: unknown): Promise<MemoryView> {
    const review = parseReview(raw);
    const memory = await this.repository.review({
      scope,
      id: memoryId,
      expectedVersion: review.expectedVersion,
      decision: review.decision,
      ...(review.content === undefined ? {} : { content: review.content }),
      now: this.clock.nowUnixSeconds(),
    });
    const action =
      review.decision === 'publish'
        ? 'AGENT_MEMORY_PUBLISHED'
        : review.decision === 'reject'
          ? 'AGENT_MEMORY_REJECTED'
          : 'AGENT_MEMORY_REVOKED';
    await this.audit.logAction(action, { userId: scope.userId, appId: scope.appId, memoryId }).catch(() => undefined);
    return memory;
  }

  async previewImport(scope: Scope, sourceAppId: string, sourceMemoryId: string): Promise<MemoryImportConfirmation> {
    if (!nonEmpty(sourceAppId, 128) || !nonEmpty(sourceMemoryId, 128) || sourceAppId === scope.appId) {
      throw new Error('VALIDATION_FAILED');
    }
    const target = this.registry.get(scope.appId);
    if (!target.manifest.intents.some((intent) => intent.id === IMPORT_INTENT)) throw new Error('APP_INTENT_DENIED');
    const source = await this.repository.getOwned(scope.userId, sourceAppId, sourceMemoryId);
    const now = this.clock.nowUnixSeconds();
    if (!source || source.status !== 'published' || (source.expiresAt !== null && source.expiresAt <= now)) {
      throw new Error('MEMORY_NOT_IMPORTABLE');
    }
    await this.repository.deleteExpiredImportConfirmations(now);
    const snapshot: JsonValue = {
      content: source.content,
      confidence: source.confidence,
      expiresAt: source.expiresAt,
      sourceRefs: source.sourceRefs,
    };
    const confirmation: MemoryImportConfirmation = {
      id: randomUUID(),
      userId: scope.userId,
      appId: scope.appId,
      sourceAppId,
      sourceMemoryId,
      sourceVersion: source.version,
      snapshot,
      createdAt: now,
      expiresAt: now + IMPORT_CONFIRMATION_TTL_SECONDS,
    };
    await this.repository.saveImportConfirmation(confirmation);
    return confirmation;
  }

  async confirmImport(scope: Scope, confirmationId: string): Promise<MemoryView> {
    if (!nonEmpty(confirmationId, 128)) throw new Error('VALIDATION_FAILED');
    const now = this.clock.nowUnixSeconds();
    const confirmation = await this.repository.getImportConfirmation(scope, confirmationId);
    if (!confirmation) throw new Error('MEMORY_IMPORT_CONFIRMATION_NOT_FOUND');
    if (confirmation.expiresAt <= now) {
      await this.repository.deleteImportConfirmation(scope, confirmationId);
      throw new Error('MEMORY_IMPORT_CONFIRMATION_EXPIRED');
    }
    const target = this.registry.get(scope.appId);
    if (!target.manifest.intents.some((intent) => intent.id === IMPORT_INTENT)) throw new Error('APP_INTENT_DENIED');
    const source = await this.repository.getOwned(scope.userId, confirmation.sourceAppId, confirmation.sourceMemoryId);
    if (
      !source ||
      source.status !== 'published' ||
      source.version !== confirmation.sourceVersion ||
      (source.expiresAt !== null && source.expiresAt <= now)
    ) {
      throw new Error('MEMORY_IMPORT_SOURCE_CHANGED');
    }
    const memory = await this.repository.importPublished({
      id: randomUUID(),
      scope,
      content: source.content,
      sourceRefs: {
        kind: 'cross_app_import',
        sourceAppId: confirmation.sourceAppId,
        sourceMemoryId: source.id,
        sourceVersion: source.version,
        sourceRefs: source.sourceRefs,
      },
      confidence: source.confidence,
      expiresAt: source.expiresAt,
      now,
    });
    await this.repository.deleteImportConfirmation(scope, confirmationId);
    await this.audit
      .logAction('AGENT_MEMORY_IMPORTED', {
        userId: scope.userId,
        sourceAppId: confirmation.sourceAppId,
        sourceMemoryId: confirmation.sourceMemoryId,
        targetAppId: scope.appId,
        memoryId: memory.id,
      })
      .catch(() => undefined);
    return memory;
  }
}
