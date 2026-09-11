import type { JsonValue, Scope } from '../../agent.types';
import type { RunPlan } from '../planning/plan.types';

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
  supersedeUnconsumedApprovals(scope: Scope, runId: string, now: number): Promise<number>;
}
