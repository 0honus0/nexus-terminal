import { createHash, randomUUID } from 'node:crypto';
import type { ClockPort, JsonValue, Scope } from '../agent.types';
import type { LedgerEntryView } from './conversation.repository.port';
import { ConversationService } from './conversation.service';
import type {
  ContextCheckpointRepositoryPort,
  ContextCheckpointView,
  ContextCheckpointVisibility,
} from './context-checkpoint.repository.port';
import type { ContextHistoryBoundary } from './context.types';
import { estimateTokens } from './model-accounting';

const STRATEGY_VERSION = 'context-checkpoint-v1';
const GENERATOR_VERSION = 'deterministic-summary-v1';

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
};

const stableHash = (value: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(canonicalize(value)), 'utf8')
    .digest('hex');

const payloadText = (payload: JsonValue): string => {
  if (typeof payload === 'string') return payload;
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') return JSON.stringify(payload);
  const record = payload as Record<string, JsonValue>;
  for (const key of ['text', 'content', 'message', 'summary']) {
    if (typeof record[key] === 'string') return record[key] as string;
  }
  return JSON.stringify(payload);
};

const clip = (value: string, maxCharacters = 220): string => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxCharacters) return normalized;
  return `${normalized.slice(0, Math.max(0, maxCharacters - 1))}…`;
};

const sampled = (entries: readonly LedgerEntryView[], limit: number): LedgerEntryView[] => {
  if (entries.length <= limit) return [...entries];
  const head = Math.min(2, limit);
  const tail = Math.max(0, limit - head);
  return tail > 0 ? [...entries.slice(0, head), ...entries.slice(-tail)] : entries.slice(0, head);
};

const collectRefs = (value: JsonValue, refs: Set<string>, keyHint = ''): void => {
  if (typeof value === 'string') {
    if (/ref$/i.test(keyHint) && value) refs.add(value);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, refs, keyHint);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (/refs$/i.test(key) && Array.isArray(item)) {
      for (const ref of item) if (typeof ref === 'string' && ref) refs.add(ref);
      continue;
    }
    collectRefs(item, refs, key);
  }
};

const lineForEntry = (entry: LedgerEntryView): string => `#${entry.sequence} ${clip(payloadText(entry.payload))}`;

const buildSummary = (
  entries: readonly LedgerEntryView[],
  fromSequence: number,
  toSequence: number,
  maxTokens: number,
): { content: string; tokens: number } | null => {
  const userEntries = entries.filter((entry) => entry.kind === 'user_input' && payloadText(entry.payload).trim());
  const highSignalUserEntries = userEntries.filter((entry) =>
    /\b(objective|goal|constraint|decision|must|never|do not|don't|without|preserve|require(?:d|ment)?|only|forbid(?:den)?)\b/i.test(
      payloadText(entry.payload),
    ),
  );
  const failedEntries = entries.filter((entry) =>
    /\b(fail(?:ed|ure)?|error|exception|ruled[ -]?out|did not work|invalid|denied|timeout|panic)\b/i.test(
      payloadText(entry.payload),
    ),
  );
  const completedEntries = entries.filter((entry) =>
    /\b(completed|complete|done|fixed|implemented|verified|passed|succeeded|success)\b/i.test(
      payloadText(entry.payload),
    ),
  );
  const stateEntries = entries
    .filter((entry) => entry.kind === 'assistant_message' || entry.kind === 'system_notice')
    .slice(-6);
  const refs = new Set<string>();
  for (const entry of entries) collectRefs(entry.payload, refs);

  const sections: Array<{ title: string; lines: string[] }> = [
    {
      title: 'Failed / ruled-out attempts',
      lines: sampled(failedEntries, 8).map(lineForEntry),
    },
    {
      title: 'Objective / constraints / user decisions',
      lines: sampled(highSignalUserEntries.length > 0 ? highSignalUserEntries : userEntries, 4).map(lineForEntry),
    },
    {
      title: 'Completed work',
      lines: sampled(completedEntries, 5).map(lineForEntry),
    },
    {
      title: 'Current state / pending work / next action',
      lines: sampled(stateEntries, 6).map(lineForEntry),
    },
    {
      title: 'Relevant artifacts / evidence',
      lines: [...refs].slice(0, 16).map((ref) => ref),
    },
  ];

  let content =
    '[Derived Context checkpoint; optimization only. Canonical Ledger remains authoritative.]\n' +
    `Coverage: ledger sequences ${fromSequence}-${toSequence}.\n`;
  if (estimateTokens(content) > maxTokens) return null;

  for (const section of sections) {
    if (section.lines.length === 0) continue;
    const header = `\n${section.title}:\n`;
    let candidate = content + header;
    if (estimateTokens(candidate) > maxTokens) continue;
    content = candidate;
    for (const line of section.lines) {
      candidate = `${content}- ${line}\n`;
      if (estimateTokens(candidate) > maxTokens) break;
      content = candidate;
    }
  }
  const tokens = estimateTokens(content);
  return tokens > 0 ? { content: content.trimEnd(), tokens } : null;
};

export interface ContextCheckpointRequest {
  scope: Scope;
  threadId: string;
  runId?: string;
  historyBoundary?: ContextHistoryBoundary;
  throughSequence: number;
  maxSummaryTokens: number;
  hardPressure: boolean;
}

export class ContextCheckpointService {
  constructor(
    private readonly repository: ContextCheckpointRepositoryPort,
    private readonly conversations: ConversationService,
    private readonly clock: ClockPort,
  ) {}

  async checkpointForPrefix(input: ContextCheckpointRequest): Promise<ContextCheckpointView | null> {
    if (
      !Number.isSafeInteger(input.throughSequence) ||
      input.throughSequence < 1 ||
      !Number.isSafeInteger(input.maxSummaryTokens) ||
      input.maxSummaryTokens < 64
    ) {
      throw new Error('VALIDATION_FAILED');
    }
    if ((input.historyBoundary === undefined) !== (input.runId === undefined)) {
      throw new Error('VALIDATION_FAILED');
    }

    const visibility: ContextCheckpointVisibility =
      input.historyBoundary && input.runId
        ? {
            kind: 'run_boundary',
            runId: input.runId,
            historyBoundary: {
              baseThrough: input.historyBoundary.baseThrough,
              runThrough: { ...input.historyBoundary.runThrough },
            },
          }
        : { kind: 'thread_prefix' };
    const visibilityHash = stableHash(visibility);
    const entries = await this.conversations.readVisibleThrough(
      input.scope,
      input.threadId,
      input.throughSequence,
      input.historyBoundary ? input.runId : undefined,
      input.historyBoundary,
    );
    if (entries.length === 0) return null;
    const fromSequence = entries[0]!.sequence;
    const toSequence = entries.at(-1)!.sequence;
    const sourceHash = stableHash(
      entries.map((entry) => ({
        id: entry.id,
        runId: entry.runId,
        sequence: entry.sequence,
        kind: entry.kind,
        payload: entry.payload,
      })),
    );
    const sourceTokens = entries.reduce(
      (total, entry) => total + estimateTokens(JSON.stringify({ kind: entry.kind, payload: entry.payload })),
      0,
    );
    const existing = await this.repository.getExact(
      input.scope,
      input.threadId,
      visibilityHash,
      fromSequence,
      toSequence,
      STRATEGY_VERSION,
    );
    if (
      existing &&
      existing.sourceHash === sourceHash &&
      existing.generator.kind === 'deterministic' &&
      existing.generator.version === GENERATOR_VERSION &&
      existing.summaryTokens <= input.maxSummaryTokens
    ) {
      return existing;
    }

    const summary = buildSummary(entries, fromSequence, toSequence, input.maxSummaryTokens);
    if (!summary) return null;
    if (!input.hardPressure && summary.tokens >= Math.floor(sourceTokens * 0.75)) return null;

    return this.repository.upsert({
      scope: input.scope,
      id: randomUUID(),
      threadId: input.threadId,
      visibilityHash,
      visibility,
      fromSequence,
      toSequence,
      sourceHash,
      strategyVersion: STRATEGY_VERSION,
      generator: { kind: 'deterministic', version: GENERATOR_VERSION },
      sourceTokens,
      summaryTokens: summary.tokens,
      content: summary.content,
      createdAt: this.clock.nowUnixSeconds(),
    });
  }
}
