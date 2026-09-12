import type { RunPlan } from '../../../modules/agent/runtime/planning/plan.types';
import type {
  RunBudget,
  RunDefinitionSnapshot,
  RunStatus,
  RunUsage,
  RunView,
} from '../../../modules/agent/runtime/runs/run.types';

export interface RunRow {
  id: string;
  user_id: number;
  app_id: string;
  thread_id: string;
  parent_run_id: string | null;
  status: RunStatus;
  goal_status: RunView['goalStatus'];
  goal_text: string | null;
  goal_revision: number;
  goal_updated_at: number | null;
  verification_status: RunView['verificationStatus'];
  needs_reconciliation: number;
  budget_json: string;
  definition_json: string;
  plan_json: string;
  usage_json: string;
  active_execution_seconds: number;
  active_execution_started_at: number | null;
  executing_runtime_count: number;
  consumed_input_sequence: number;
  input_revision: number;
  next_event_sequence: number;
  version: number;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  updated_at: number;
}

export const persistedPlan = (raw: string): RunPlan => {
  const value = JSON.parse(raw) as Partial<RunPlan>;
  if (
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision ?? -1) < 0 ||
    !Array.isArray(value.items)
  ) {
    return { schemaVersion: 1, revision: 0, items: [] };
  }
  return value as RunPlan;
};

export const RUN_COLUMNS = `
  id, user_id, app_id, thread_id, parent_run_id, status, goal_status, goal_text, goal_revision, goal_updated_at, verification_status,
  needs_reconciliation, budget_json, definition_json, plan_json, usage_json,
  active_execution_seconds, active_execution_started_at, executing_runtime_count,
  consumed_input_sequence, input_revision, next_event_sequence,
  version, created_at, started_at, completed_at, updated_at
`;

export const mapRunRow = (row: RunRow): RunView => ({
  id: row.id,
  userId: row.user_id,
  appId: row.app_id,
  threadId: row.thread_id,
  parentRunId: row.parent_run_id,
  status: row.status,
  goalStatus: row.goal_status,
  goal: { text: row.goal_text, revision: row.goal_revision, updatedAt: row.goal_updated_at },
  verificationStatus: row.verification_status,
  needsReconciliation: row.needs_reconciliation === 1,
  budget: JSON.parse(row.budget_json) as RunBudget,
  definition: JSON.parse(row.definition_json) as RunDefinitionSnapshot,
  plan: persistedPlan(row.plan_json),
  usage: JSON.parse(row.usage_json) as RunUsage,
  activeExecutionSeconds: row.active_execution_seconds,
  activeExecutionStartedAt: row.active_execution_started_at,
  executingRuntimeCount: row.executing_runtime_count,
  consumedInputSequence: row.consumed_input_sequence,
  inputRevision: row.input_revision,
  eventCursor: row.next_event_sequence - 1,
  version: row.version,
  createdAt: row.created_at,
  startedAt: row.started_at,
  completedAt: row.completed_at,
  updatedAt: row.updated_at,
});
