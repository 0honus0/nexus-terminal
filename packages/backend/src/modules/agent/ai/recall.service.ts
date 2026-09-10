import type { ClockPort, JsonValue, Scope } from '../agent.types';
import type { RecallRepositoryPort } from './recall.repository.port';

export interface RecallItem {
  id: string;
  content: string;
  sourceRefs: JsonValue;
  confidence: number;
  score: number;
  updatedAt: number;
}

const terms = (value: string): string[] =>
  [
    ...new Set(
      value
        .toLowerCase()
        .split(/[^\p{L}\p{N}_-]+/u)
        .filter((term) => term.length >= 2),
    ),
  ].slice(0, 64);

export class RecallService {
  constructor(
    private readonly repository: RecallRepositoryPort,
    private readonly clock: ClockPort,
  ) {}

  async recall(scope: Scope, query: string, limit = 5, maxBytes = 8192): Promise<RecallItem[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new Error('VALIDATION_FAILED');
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 32_768) throw new Error('VALIDATION_FAILED');
    const queryTerms = terms(query);
    if (queryTerms.length === 0) return [];

    const now = this.clock.nowUnixSeconds();
    const candidates = await this.repository.publishedCandidates(scope, now, 1000);
    const ranked = candidates
      .map((candidate) => {
        const content = candidate.content.toLowerCase();
        const matched = queryTerms.reduce((count, term) => count + (content.includes(term) ? 1 : 0), 0);
        if (matched === 0) return null;
        const ageDays = Math.max(0, (now - candidate.updatedAt) / 86_400);
        const freshness = 1 / (1 + ageDays / 30);
        const lexical = matched / queryTerms.length;
        const score = lexical * 0.65 + candidate.confidence * 0.2 + freshness * 0.15;
        return {
          id: candidate.id,
          content: candidate.content,
          sourceRefs: candidate.sourceRefs,
          confidence: candidate.confidence,
          score,
          updatedAt: candidate.updatedAt,
        } satisfies RecallItem;
      })
      .filter((item): item is RecallItem => item !== null)
      .sort(
        (left, right) =>
          right.score - left.score || right.updatedAt - left.updatedAt || left.id.localeCompare(right.id),
      );

    const selected: RecallItem[] = [];
    let bytes = 0;
    for (const item of ranked) {
      const itemBytes =
        Buffer.byteLength(item.content, 'utf8') + Buffer.byteLength(JSON.stringify(item.sourceRefs), 'utf8');
      if (bytes + itemBytes > maxBytes) continue;
      selected.push(item);
      bytes += itemBytes;
      if (selected.length >= limit) break;
    }
    return selected;
  }
}
