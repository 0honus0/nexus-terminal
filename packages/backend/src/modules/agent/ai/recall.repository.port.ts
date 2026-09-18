import type { JsonValue, Scope } from '../agent.types';

export interface RecallCandidate {
  id: string;
  content: string;
  sourceRefs: JsonValue;
  confidence: number;
  expiresAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface RecallRepositoryPort {
  searchPublishedCandidates(
    scope: Scope,
    now: number,
    queryTerms: readonly string[],
    candidateLimit: number,
  ): Promise<RecallCandidate[]>;
}

export type { JsonValue, Scope } from '../agent.types';
