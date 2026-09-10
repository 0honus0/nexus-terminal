import type { JsonValue, Scope } from '../agent.types';

export type MemoryStatus = 'candidate' | 'published' | 'revoked';
export type MemoryReviewAction = 'publish' | 'reject' | 'revoke';

export interface MemoryView extends Scope {
  id: string;
  content: string;
  sourceRefs: JsonValue;
  confidence: number;
  status: MemoryStatus;
  expiresAt: number | null;
  proposedByRuntimeId: string | null;
  reviewAction: MemoryReviewAction | null;
  reviewedAt: number | null;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryImportConfirmation extends Scope {
  id: string;
  sourceAppId: string;
  sourceMemoryId: string;
  sourceVersion: number;
  snapshot: JsonValue;
  createdAt: number;
  expiresAt: number;
}

export interface MemoryRepositoryPort {
  get(scope: Scope, id: string): Promise<MemoryView | null>;
  getOwned(userId: number, appId: string, id: string): Promise<MemoryView | null>;
  list(scope: Scope, status: MemoryStatus | 'all', limit: number): Promise<MemoryView[]>;
  propose(record: {
    id: string;
    scope: Scope;
    content: string;
    sourceRefs: JsonValue;
    confidence: number;
    expiresAt: number | null;
    proposedByRuntimeId: string | null;
    now: number;
  }): Promise<MemoryView>;
  importPublished(record: {
    id: string;
    scope: Scope;
    content: string;
    sourceRefs: JsonValue;
    confidence: number;
    expiresAt: number | null;
    now: number;
  }): Promise<MemoryView>;
  review(record: {
    scope: Scope;
    id: string;
    expectedVersion: number;
    decision: MemoryReviewAction;
    content?: string;
    now: number;
  }): Promise<MemoryView>;
  saveImportConfirmation(record: MemoryImportConfirmation): Promise<void>;
  getImportConfirmation(scope: Scope, confirmationId: string): Promise<MemoryImportConfirmation | null>;
  deleteImportConfirmation(scope: Scope, confirmationId: string): Promise<void>;
  deleteExpiredImportConfirmations(now: number): Promise<number>;
}
