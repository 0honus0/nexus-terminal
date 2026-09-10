import type { JsonValue } from '../agent.types';

export type LeaseMode = 'read' | 'write';
export type LeaseOwnerType = 'agent' | 'workspace' | 'system';

/** Concrete lease-holder identity. It may be runtime-scoped or operation-scoped. */
export interface LeaseOwner {
  type: LeaseOwnerType;
  id: string;
}

/** One resource claim in an atomic mixed-mode lease acquisition. */
export interface LeaseResourceRequest {
  resourceKey: string;
  mode: LeaseMode;
}

export interface ResourceLease {
  id: string;
  resourceKey: string;
  mode: LeaseMode;
  owner: LeaseOwner;
  fence: number;
  acquiredAt: number;
  expiresAt: number;
  activeMutation: boolean;
  operationId: string | null;
}

export interface ResourceQuarantine {
  resourceKey: string;
  toolCallId: string | null;
  owner: LeaseOwner;
  reason: string;
  evidence: JsonValue;
  version: number;
  createdAt: number;
}

export interface LeasePort {
  acquireMany(
    owner: LeaseOwner,
    resourceKeys: readonly string[],
    mode: LeaseMode,
    ttlSeconds?: number,
  ): Promise<ResourceLease[]>;
  acquireResources(
    owner: LeaseOwner,
    resources: readonly LeaseResourceRequest[],
    ttlSeconds?: number,
  ): Promise<ResourceLease[]>;
  renew(leaseIds: readonly string[], owner: LeaseOwner, ttlSeconds?: number): Promise<ResourceLease[]>;
  markMutationActive(leaseIds: readonly string[], owner: LeaseOwner, operationId: string): Promise<void>;
  markMutationSettled(leaseIds: readonly string[], owner: LeaseOwner, operationId: string): Promise<void>;
  release(leaseIds: readonly string[], owner: LeaseOwner): Promise<void>;
  quarantine(
    owner: LeaseOwner,
    resourceKeys: readonly string[],
    reason: string,
    evidence: JsonValue,
    toolCallId?: string,
  ): Promise<ResourceQuarantine[]>;
  getQuarantine(resourceKey: string): Promise<ResourceQuarantine | null>;
  resolveQuarantine(resourceKey: string, expectedVersion: number): Promise<void>;
}
