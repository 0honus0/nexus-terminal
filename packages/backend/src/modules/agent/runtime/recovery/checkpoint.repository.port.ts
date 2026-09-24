import type { Scope } from '../../agent.types';
import type { ModelRef } from '../../ai/model.types';
import type { ToolRisk } from '../../capabilities/tool.types';
import type { RunPlan } from '../planning/plan.types';
import type { RunContextBoundary, RunGoal } from '../runs/run.types';

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
  risk: ToolRisk;
  status: CheckpointToolStatus;
  sideEffectStatus: 'not_started' | 'confirmed' | 'unknown';
  verificationStatus: 'not_started' | 'verified' | 'unverified' | 'failed';
  quarantinedResourceKeys: string[];
}

export interface CheckpointDelegationRecoveryEntry {
  delegationId: string;
  status: 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
}

export type CheckpointKind = 'user' | 'recovery';
export type CheckpointBackgroundJobStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'unknown' | 'cancelled';

export interface CheckpointBackgroundJobEntry {
  jobId: string;
  workspaceId: string;
  generation: number;
  status: CheckpointBackgroundJobStatus;
}

export interface CheckpointRunBackgroundJob extends CheckpointBackgroundJobEntry {
  toolCallIds: string[];
}

export interface CheckpointRecoveryManifest {
  schemaVersion: 1;
  eventThrough: number;
  contextBoundary: RunContextBoundary;
  tools: CheckpointToolRecoveryEntry[];
  delegations: CheckpointDelegationRecoveryEntry[];
  backgroundJobs: CheckpointBackgroundJobEntry[];
  quarantinedResourceKeys: string[];
}

export interface CheckpointSnapshot {
  schemaVersion: 1;
  runId: string;
  ledgerThrough: number;
  planVersion: number;
  inputRevision: number;
  settingsRevision: number;
  plan: RunPlan;
  goal: RunGoal;
  completedStepIds: string[];
  evidenceRefs: string[];
  checkpointArtifactRefs: string[];
  modelConfigurationVersion: number;
  activeModel: ModelRef;
  definitionVersion: string;
  policyRevision: number;
  workspaceArtifactManifestRefs: string[];
  workspaceArtifactRefs: string[];
  recoveryManifest: CheckpointRecoveryManifest;
}

export interface CheckpointView {
  id: string;
  runId: string;
  kind: CheckpointKind;
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

export interface CheckpointWorkspaceCapture {
  workspaceId: string;
  generation: number;
  expectedVersion: number;
  manifestArtifactId: string;
  artifactRefs: string[];
}

export interface CheckpointWorkspaceReference {
  manifestArtifactIds: string[];
  artifactRefs: string[];
}

export interface SaveCheckpointCommand {
  scope: Scope;
  checkpointId: string;
  kind: CheckpointKind;
  runId: string;
  expectedRunVersion: number;
  definitionVersion: string;
  activeModel: ModelRef;
  workspaceCaptures: CheckpointWorkspaceCapture[];
  workspaceReference?: CheckpointWorkspaceReference;
  backgroundJobs: CheckpointBackgroundJobEntry[];
  now: number;
}

export interface CheckpointRepositoryPort {
  save(command: SaveCheckpointCommand): Promise<CheckpointView>;
  get(scope: Scope, checkpointId: string): Promise<CheckpointView | null>;
  list(scope: Scope, runId: string, limit?: number): Promise<CheckpointView[]>;
  latestRecovery(scope: Scope, runId: string): Promise<CheckpointView | null>;
  deleteRecovery(scope: Scope, runId: string, checkpointId: string): Promise<void>;
  deleteUser(scope: Scope, runId: string, checkpointId: string): Promise<void>;
  runBackgroundJobs(scope: Scope, runId: string): Promise<CheckpointRunBackgroundJob[]>;
  missingArtifactRefs(scope: Scope, checkpointId: string): Promise<string[]>;
  recoveryHazards(scope: Scope, checkpointId: string): Promise<CheckpointRecoveryHazards>;
}
