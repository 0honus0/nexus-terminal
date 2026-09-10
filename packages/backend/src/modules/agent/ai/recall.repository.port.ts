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
  publishedCandidates(scope: Scope, now: number, scanLimit: number): Promise<RecallCandidate[]>;
}

export type { JsonValue, Scope } from '../agent.types';
