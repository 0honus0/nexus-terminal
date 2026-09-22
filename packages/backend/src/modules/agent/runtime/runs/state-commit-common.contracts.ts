import type { AgentDurableEventTypeDto } from '@nexus-terminal/protocol/agent-events';
import type { JsonValue, Scope } from '../../agent.types';
import type { LedgerEntryKind } from '../../ai/conversation.repository.port';
import type { RunPlan } from '../planning/plan.types';
import type { RunBudget, RunEvent, RunUsage, RunView } from './run.types';

export interface DurableEventInput {
  type: AgentDurableEventTypeDto;
  payload: JsonValue;
}

export interface LedgerAppendInput {
  id: string;
  kind: LedgerEntryKind;
  payload: JsonValue;
  runId?: string;
}

export interface RunProjectionPatch {
  status?: RunView['status'];
  goalStatus?: RunView['goalStatus'];
  verificationStatus?: RunView['verificationStatus'];
  needsReconciliation?: boolean;
  budget?: RunBudget;
  usage?: RunUsage;
  plan?: RunPlan;
  consumedInputSequence?: number;
  inputRevision?: number;
  startedAt?: number | null;
  completedAt?: number | null;
}

export interface StateCommitCommand {
  scope: Scope;
  runId: string;
  expectedRunVersion: number;
  expectedInputRevision?: number;
  expectedPolicyRevision?: number;
  events: DurableEventInput[];
  runPatch: RunProjectionPatch;
  ledgerAppends?: LedgerAppendInput[];
  now: number;
}

export interface StateCommitResult {
  run: RunView;
  eventCursor: number;
  ledgerCursor: number;
  committedEvents: RunEvent[];
}
