import type { JsonValue, Scope } from '../../agent.types';
import type { ModelRef } from '../../ai/model.types';
import type { LedgerEntryKind } from '../../ai/conversation.repository.port';
import type { RunPlan } from '../planning/plan.types';
import type { RunBudget, RunDefinitionSnapshot, RunGoal, RunView, UserInputData } from './run.types';

export interface AtomicCreateRun {
  scope: Scope;
  runId: string;
  runtimeId: string;
  threadId: string;
  inputEntryId: string;
  input: UserInputData;
  automaticThreadTitle?: string;
  parentRunId?: string | null;
  initialEntry?: { kind: LedgerEntryKind; payload: JsonValue; artifactRefs: string[] };
  initialPlan?: RunPlan;
  initialGoal?: RunGoal;
  agentDefinitionId: string;
  model: ModelRef;
  connectionIds: number[];
  budget: RunBudget;
  definition: RunDefinitionSnapshot;
  expectedPolicyRevision: number;
  idempotencyKey: string;
  requestHash: string;
  requestId: string;
  now: number;
}

export interface CreateRunCommitResult {
  run: RunView;
  inputSequence: number;
  replayed: boolean;
}

export interface AtomicAppendInput {
  scope: Scope;
  runId: string;
  inputEntryId: string;
  input: UserInputData;
  automaticThreadTitle?: string;
  mode: 'append' | 'interrupt';
  expectedRunVersion: number;
  idempotencyKey: string;
  requestHash: string;
  now: number;
}

export interface AppendInputCommitResult {
  inputId: string;
  sequence: number;
  runVersion: number;
  run: RunView;
  replayed: boolean;
  shouldInterruptModel: boolean;
  shouldReschedule: boolean;
}

export interface AtomicMutatePendingInput {
  scope: Scope;
  runId: string;
  action: 'remove' | 'move';
  inputId: string;
  beforeInputId: string | null;
  expectedRunVersion: number;
  idempotencyKey: string;
  requestHash: string;
  now: number;
}

export interface MutatePendingInputCommitResult {
  run: RunView;
  replayed: boolean;
  shouldInterruptModel: boolean;
}

export interface AtomicSetRunGoal {
  scope: Scope;
  runId: string;
  text: string;
  expectedRunVersion: number;
  idempotencyKey: string;
  requestHash: string;
  now: number;
}

export interface SetRunGoalCommitResult {
  run: RunView;
  replayed: boolean;
  shouldInterruptModel: boolean;
  shouldReschedule: boolean;
}

export interface AtomicCancelRun {
  scope: Scope;
  runId: string;
  expectedRunVersion: number;
  idempotencyKey: string;
  requestHash: string;
  now: number;
}

export interface CancelRunCommitResult {
  run: RunView;
  accepted: boolean;
  replayed: boolean;
}

export interface AtomicIncreaseRunBudget {
  scope: Scope;
  runId: string;
  expectedRunVersion: number;
  budget: RunBudget;
  idempotencyKey: string;
  requestHash: string;
  now: number;
}

export interface IncreaseRunBudgetCommitResult {
  run: RunView;
  replayed: boolean;
}

export interface AtomicDeleteRun {
  scope: Scope;
  runId: string;
  expectedRunVersion: number;
  idempotencyKey: string;
  requestHash: string;
  now: number;
}

export interface DeleteRunCommitResult {
  runId: string;
  deleted: true;
  replayed: boolean;
  hostEventCursor: number;
}

export interface ResolveRunReconciliationResource {
  resourceKey: string;
  version: number;
}

export interface ResolveRunReconciliationCommand {
  scope: Scope;
  runId: string;
  expectedRunVersion: number;
  note: string;
  resources: ResolveRunReconciliationResource[];
  now: number;
}
