import type { AgentErrorRule } from './rule';
import { onCodes, rawCode } from './rule';

export const collaborationErrorRules: readonly AgentErrorRule[] = [
  onCodes(
    [
      'SUBAGENT_PROFILE_NOT_FOUND',
      'DELEGATION_NOT_FOUND',
      'AGENT_RUNTIME_NOT_FOUND',
      'MEMORY_NOT_FOUND',
      'MEMORY_IMPORT_CONFIRMATION_NOT_FOUND',
    ],
    { status: 404, code: 'NOT_FOUND', message: 'Agent collaboration resource was not found.' },
  ),
  onCodes(
    [
      'DELEGATION_DEPTH_EXCEEDED',
      'SUBAGENT_MODEL_NOT_ALLOWED',
      'SUBAGENT_MODEL_UNAVAILABLE',
      'DELEGATION_WAIT_CYCLE',
      'DEPENDENCY_NOT_FOUND',
      'DEPENDENCY_FAILED',
      'DELEGATION_DEADLINE_EXCEEDED',
      'DELEGATION_BUDGET_EXCEEDED',
      'RUN_BUDGET_EXCEEDED',
      'MAILBOX_FULL',
      'MAILBOX_BUDGET_EXCEEDED',
      'MAILBOX_HARD_LIMIT_EXCEEDED',
      'MESSAGE_STALE',
      'MESSAGE_RECIPIENT_INVALID',
      'FACT_VERSION_CONFLICT',
      'FACT_QUOTA_EXCEEDED',
      'MEMORY_VERSION_CONFLICT',
      'MEMORY_REVIEW_STATE_INVALID',
      'MEMORY_IMPORT_CONFIRMATION_EXPIRED',
      'MEMORY_IMPORT_SOURCE_CHANGED',
      'MEMORY_NOT_IMPORTABLE',
      'IDEMPOTENCY_KEY_CONFLICT',
    ],
    rawCode(409, 'Agent collaboration state changed or cannot accept this operation.'),
  ),
  onCodes(
    ['MESSAGE_TOO_LARGE', 'FACT_TOO_LARGE', 'MEMORY_SOURCE_REFS_TOO_LARGE'],
    rawCode(413, 'Agent collaboration payload is too large.'),
  ),
  onCodes(
    ['MESSAGE_PEER_FORBIDDEN', 'RESOURCE_FORBIDDEN', 'APP_INTENT_DENIED', 'ARTIFACT_NOT_AUTHORIZED_FOR_RUN'],
    rawCode(403, 'Agent collaboration operation is not authorized.'),
  ),
  onCodes(
    ['SUBAGENT_PROFILE_HARD_LIMIT_EXCEEDED', 'FACT_KEY_INVALID'],
    rawCode(400, 'Invalid Agent collaboration configuration.'),
  ),
  onCodes(
    [
      'APP_INTENT_INVALID',
      'APP_INTENT_PAYLOAD_INVALID',
      'APP_INTENT_ARTIFACT_REF_INVALID',
      'APP_INTENT_CONFIRMATION_REQUIRED',
    ],
    rawCode(400, 'Invalid AppIntent transfer request.'),
  ),
  onCodes(['APP_INTENT_PAYLOAD_TOO_LARGE'], rawCode(413, 'AppIntent payload is too large.')),
  onCodes(
    [
      'APP_INTENT_SELF_TRANSFER_DENIED',
      'APP_INTENT_UNDECLARED',
      'APP_INTENT_SCHEMA_MISMATCH',
      'APP_INTENT_SENSITIVE_FIELD_DENIED',
    ],
    rawCode(422, 'AppIntent transfer is incompatible with the selected apps.'),
  ),
  onCodes(
    ['APP_INTENT_SENDER_GRANT_DENIED', 'APP_INTENT_RECEIVER_GRANT_DENIED', 'APP_INTENT_ARTIFACT_NOT_AUTHORIZED'],
    rawCode(403, 'AppIntent transfer is not authorized by current grants.'),
  ),
  onCodes(['APP_INTENT_APP_UNAVAILABLE'], rawCode(409, 'An AppIntent participant is not currently available.')),
  onCodes(['APP_INTENT_ARTIFACT_RANGE_INVALID'], rawCode(416, 'AppIntent Artifact range is not satisfiable.')),
  onCodes(['APP_INTENT_NOT_FOUND', 'APP_INTENT_ARTIFACT_NOT_FOUND'], {
    status: 404,
    code: 'NOT_FOUND',
    message: 'AppIntent receipt or Artifact was not found.',
  }),
];
