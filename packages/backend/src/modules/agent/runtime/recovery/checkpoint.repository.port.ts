import type { JsonValue, Scope } from '../../agent.types';
import type { RunPlan } from '../planning/plan.types';
import type { RunContextBoundary } from '../runs/run.types';

export type CheckpointToolStatus =
  | 'proposed'
  | 'awaiting_approval'
  | 'ready'
  | 'running'
  | 'succeeded'
  | 'verification_failed'
  | 'failed'
  | 'cancelled'
  | 'reconciling';

export interface CheckpointToolRecoveryEntry {
  toolCallId: string;
  operationHash: string;
  risk: 'read' | 'mutate' | 'destructive';
  status: CheckpointToolStatus;
  sideEffectStatus: 'not_started' | 'confirmed' | 'unknown';
  verificationStatus: 'not_started' | 'verified' | 'unverified' | 'failed';
  quarantinedResourceKeys: string[];
}

export interface CheckpointDelegationRecoveryEntry {
  delegationId: string;
  status: 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
}

export interface CheckpointRecoveryManifest {
  schemaVersion: 1;
  eventThrough: number;
  contextBoundary: RunContextBoundary;
  tools: CheckpointToolRecoveryEntry[];
  delegations: CheckpointDelegationRecoveryEntry[];
  quarantinedResourceKeys: string[];
}

export interface CheckpointSnapshot {
  schemaVersion: 1;
  runId: string;
  ledgerThrough: number;
  planVersion: number;
  plan: RunPlan;
  completedStepIds: string[];
  evidenceRefs: string[];
  modelConfigurationVersion: number;
  definitionVersion: string;
  policyRevision: number;
  workspaceArtifactManifestRefs: string[];
  recoveryManifest?: CheckpointRecoveryManifest;
}

export interface CheckpointView {
  id: string;
  runId: string;
  schemaVersion: 1;
  ledgerThrough: number;
  eventThrough: number;
  snapshot: CheckpointSnapshot;
  createdAt: number;
}

export interface CheckpointRecoveryHazards {
  postCheckpointMutationToolCallIds: string[];
  quarantinedResourceKeys: string[];
}

export interface SaveCheckpointCommand {
  scope: Scope;
  checkpointId: string;
  runId: string;
  expectedRunVersion: number;
  definitionVersion: string;
  now: number;
}

export interface CheckpointRepositoryPort {
  save(command: SaveCheckpointCommand): Promise<CheckpointView>;
  get(scope: Scope, checkpointId: string): Promise<CheckpointView | null>;
  list(scope: Scope, runId: string, limit?: number): Promise<CheckpointView[]>;
  missingArtifactRefs(scope: Scope, checkpointId: string): Promise<string[]>;
  recoveryHazards(scope: Scope, checkpointId: string): Promise<CheckpointRecoveryHazards>;
  supersedeUnconsumedApprovals(scope: Scope, runId: string, now: number): Promise<number>;
}
