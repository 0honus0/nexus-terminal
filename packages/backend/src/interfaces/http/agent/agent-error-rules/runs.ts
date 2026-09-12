import type { AgentErrorRule } from './rule';
import { onCodes, rawCode } from './rule';

export const runErrorRules: readonly AgentErrorRule[] = [
  onCodes(['IDEMPOTENCY_KEY_INVALID'], {
    status: 400,
    code: 'IDEMPOTENCY_KEY_INVALID',
    message: 'A UUID Idempotency-Key is required.',
  }),
  onCodes(
    ['IDEMPOTENCY_PAYLOAD_MISMATCH', 'IDEMPOTENCY_IN_PROGRESS', 'RECONCILIATION_REQUIRED'],
    rawCode(409, 'The idempotent Agent command cannot be applied in its current state.'),
  ),
  onCodes(['APPROVAL_STALE'], rawCode(409, 'The approval changed; refresh and retry.')),
  onCodes(['BUDGET_INCREASE_INVALID'], rawCode(400, 'Run budget increases must strictly raise the current budget.')),
  onCodes(
    ['BUDGET_HARD_LIMIT_EXCEEDED'],
    rawCode(422, 'The requested Run budget exceeds the current Agent Hard Limit.'),
  ),
  onCodes(
    [
      'RUN_DELETE_ACTIVE',
      'RUN_DELETE_REFERENCED',
      'RUN_DELETE_RECONCILIATION_REQUIRED',
      'RUN_DELETE_WORKSPACE_ATTACHED',
    ],
    rawCode(409, 'The Run cannot be deleted while it is active or still referenced by a Workspace.'),
  ),
  onCodes(
    [
      'CHECKPOINT_NOT_SAFE',
      'CHECKPOINT_RECOVERY_MANIFEST_MISSING',
      'CHECKPOINT_SIDE_EFFECT_DIVERGED',
      'RUN_RESUME_SOURCE_NOT_TERMINAL',
    ],
    rawCode(409, 'The Run is not at a safe checkpoint or resume boundary.'),
  ),
  onCodes(['CHECKPOINT_ARTIFACT_UNAVAILABLE'], rawCode(409, 'A checkpoint Artifact is unavailable.')),
  onCodes(
    ['CHECKPOINT_DEFINITION_STALE', 'CHECKPOINT_PROVIDER_STALE'],
    rawCode(409, 'The checkpoint runtime configuration has changed.'),
  ),
  onCodes(
    ['CHECKPOINT_PROVIDER_UNAVAILABLE', 'CHECKPOINT_MODEL_UNAVAILABLE'],
    rawCode(422, 'The checkpoint model is unavailable.'),
  ),
  onCodes(['CHECKPOINT_TARGET_DENIED'], rawCode(403, 'A checkpoint target is denied by current Host policy.')),
  onCodes(['CHECKPOINT_INVALID'], rawCode(409, 'The checkpoint is no longer valid.')),
  onCodes(
    [
      'THREAD_HAS_ACTIVE_RUN',
      'RUN_NOT_ACCEPTING_INPUT',
      'RUN_NOT_STREAMING_MODEL',
      'RUN_NOT_ACCEPTING_GOAL',
      'GOAL_REVISION_CONFLICT',
      'RUN_NOT_AWAITING_BUDGET',
      'RUN_NOT_SCHEDULABLE',
      'RUNTIME_NOT_SCHEDULABLE',
      'INPUT_REVISION_CONFLICT',
      'POLICY_REVISION_CONFLICT',
      'AGENT_APP_DISABLED',
      'AGENT_DISABLED',
    ],
    rawCode(409, 'Agent runtime state changed; refresh and retry.'),
  ),
  onCodes(['RUN_QUEUE_FULL'], rawCode(429, 'Agent capacity is temporarily exhausted.')),
  onCodes(
    ['CONTEXT_BUDGET_EXCEEDED', 'MODEL_PRICE_UNKNOWN'],
    rawCode(422, 'The selected model cannot satisfy the requested Agent budget.'),
  ),
];
