import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AgentAsyncRoute = (request: Request, response: Response, next: NextFunction) => void | Promise<void>;

export const agentRequestId = (request: Request, response: Response): string => {
  const existing = response.locals.agentRequestId;
  if (typeof existing === 'string') return existing;
  const supplied = request.header('x-request-id');
  const requestId = supplied && UUID.test(supplied) ? supplied : randomUUID();
  response.locals.agentRequestId = requestId;
  response.setHeader('X-Request-Id', requestId);
  return requestId;
};

export const agentData = (request: Request, response: Response, data: unknown, status = 200): void => {
  response.status(status).json({ data, requestId: agentRequestId(request, response) });
};

export const agentError = (
  request: Request,
  response: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): void => {
  response.status(status).json({
    error: { code, message, ...(details === undefined ? {} : { details }) },
    requestId: agentRequestId(request, response),
  });
};

const mapAgentError = (error: unknown): { status: number; code: string; message: string } => {
  const raw = error instanceof Error ? error.message : String(error);
  if (
    raw === 'VALIDATION_FAILED' ||
    raw === 'PROVIDER_ENDPOINT_INVALID' ||
    raw === 'PROVIDER_PRIVATE_EXCEPTION_INVALID'
  ) {
    return { status: 400, code: 'VALIDATION_FAILED', message: 'Invalid Agent request.' };
  }
  if (raw === 'AGENT_APP_NOT_FOUND' || raw === 'PROVIDER_NOT_FOUND' || raw.startsWith('Agent App not registered:')) {
    return { status: 404, code: 'NOT_FOUND', message: 'Agent resource was not found.' };
  }
  if (raw === 'SETTINGS_VERSION_CONFLICT') {
    return { status: 409, code: raw, message: 'Agent settings changed; refresh and retry.' };
  }
  if (
    raw === 'APP_STATE_VERSION_CONFLICT' ||
    raw === 'APP_POLICY_VERSION_CONFLICT' ||
    raw === 'PROVIDER_VERSION_CONFLICT'
  ) {
    return { status: 409, code: 'STATE_CONFLICT', message: 'Agent resource changed; refresh and retry.' };
  }
  if (raw === 'APP_CAPABILITY_UNDECLARED') {
    return { status: 422, code: raw, message: 'The Agent App does not declare one or more requested capabilities.' };
  }
  if (raw === 'APP_CAPABILITY_DENIED') {
    return { status: 403, code: raw, message: 'The Agent App capability is not granted.' };
  }
  if (
    raw === 'PROVIDER_ENDPOINT_DENIED' ||
    raw === 'PROVIDER_PRIVATE_ENDPOINT_DENIED' ||
    raw === 'PROVIDER_INSECURE_ENDPOINT_DENIED' ||
    raw === 'PROVIDER_ENDPOINT_SCHEME_DENIED'
  ) {
    return { status: 403, code: 'RESOURCE_FORBIDDEN', message: 'Provider endpoint is not allowed.' };
  }
  if (raw === 'PROVIDER_DNS_RESOLUTION_FAILED' || raw === 'PROVIDER_UNAVAILABLE') {
    return { status: 503, code: 'PROVIDER_UNAVAILABLE', message: 'Provider is unavailable.' };
  }
  if (raw === 'MODEL_NOT_FOUND' || raw === 'MODEL_CAPABILITY_UNSUPPORTED' || raw === 'MODEL_OUTPUT_LIMIT_EXCEEDED') {
    return { status: 422, code: 'MODEL_CAPABILITY_UNSUPPORTED', message: 'Model capability is unavailable.' };
  }
  if (raw === 'PAYLOAD_TOO_LARGE')
    return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Artifact payload is too large.' };
  if (raw === 'ARTIFACT_QUOTA_EXCEEDED') {
    return { status: 507, code: 'ARTIFACT_QUOTA_EXCEEDED', message: 'Artifact storage quota is exhausted.' };
  }
  if (raw === 'ARTIFACT_RANGE_INVALID') {
    return { status: 416, code: 'ARTIFACT_RANGE_INVALID', message: 'Artifact range is not satisfiable.' };
  }
  if (raw === 'ARTIFACT_UNAVAILABLE') {
    return { status: 410, code: 'ARTIFACT_UNAVAILABLE', message: 'Artifact payload is unavailable.' };
  }
  if (raw === 'ARTIFACT_UPLOAD_BUSY') {
    return { status: 429, code: 'ARTIFACT_UPLOAD_BUSY', message: 'Too many artifact uploads are active.' };
  }
  if (raw === 'ARTIFACT_UPLOAD_EXPIRED' || raw === 'ARTIFACT_SIZE_MISMATCH') {
    return { status: 409, code: raw, message: 'Artifact upload state is no longer valid.' };
  }
  if (raw === 'ARTIFACT_PROTECTED') {
    return { status: 409, code: raw, message: 'Artifact is retained or protected by an active reference.' };
  }
  if (raw === 'CLEANUP_CONFIRMATION_NOT_FOUND') {
    return { status: 404, code: raw, message: 'Artifact cleanup confirmation was not found.' };
  }
  if (raw === 'CLEANUP_CONFIRMATION_EXPIRED') {
    return { status: 409, code: raw, message: 'Artifact cleanup confirmation expired; preview again.' };
  }
  if (raw === 'HARD_LIMIT_CONFIRMATION_NOT_FOUND') {
    return { status: 404, code: raw, message: 'Hard Limit confirmation was not found.' };
  }
  if (raw === 'HARD_LIMIT_CONFIRMATION_EXPIRED') {
    return { status: 409, code: raw, message: 'Hard Limit confirmation expired; preview again.' };
  }
  if (raw === 'HARD_LIMIT_BELOW_USAGE') {
    return {
      status: 409,
      code: raw,
      message: 'Hard Limit cannot be lowered below current reserved or used resources.',
    };
  }
  if (raw === 'HARD_LIMIT_RELATION_INVALID' || raw === 'HARD_LIMIT_NO_CHANGES') {
    return { status: 400, code: raw, message: 'Invalid Hard Limit change.' };
  }
  if (raw === 'INTEGRATION_NOT_FOUND') {
    return { status: 404, code: 'NOT_FOUND', message: 'Agent integration was not found.' };
  }
  if (raw === 'INTEGRATION_VERSION_CONFLICT' || raw === 'INTEGRATION_CREDENTIAL_STALE' || raw === 'RESOURCE_CHANGED') {
    return { status: 409, code: 'STATE_CONFLICT', message: 'Agent integration changed; refresh and retry.' };
  }
  if (raw === 'INTEGRATION_DISABLED') {
    return { status: 409, code: raw, message: 'Agent integration is disabled.' };
  }
  if (raw === 'INTEGRATION_REFRESH_UNSUPPORTED' || raw === 'MCP_PROTOCOL_VERSION_UNSUPPORTED') {
    return { status: 422, code: raw, message: 'The integration protocol is not supported.' };
  }
  if (
    raw.startsWith('MCP_') ||
    raw.startsWith('INTEGRATION_ENDPOINT_') ||
    raw === 'INTEGRATION_PRIVATE_EXCEPTION_INVALID'
  ) {
    return { status: 503, code: raw, message: 'The integration endpoint is unavailable or unsafe.' };
  }
  if (raw === 'ENVIRONMENT_CONFIRMATION_NOT_FOUND') {
    return { status: 404, code: raw, message: 'Environment confirmation was not found.' };
  }
  if (raw === 'ENVIRONMENT_CONFIRMATION_EXPIRED') {
    return { status: 409, code: raw, message: 'Environment confirmation expired; preview again.' };
  }
  if (raw === 'CATALOG_REVISION_CONFLICT') {
    return { status: 409, code: raw, message: 'Environment Catalog changed; refresh and preview again.' };
  }
  if (raw === 'ENVIRONMENT_PACK_IN_USE') {
    return { status: 409, code: raw, message: 'The Environment Pack is still used by an active Environment.' };
  }
  if (raw === 'ENVIRONMENT_NETWORK_ENFORCEMENT_UNAVAILABLE') {
    return { status: 409, code: raw, message: 'Environment egress allowlists are not available on this Runner.' };
  }
  if (raw === 'ENVIRONMENT_CONTROLLER_UNAVAILABLE') {
    return { status: 503, code: raw, message: 'Environment Controller is unavailable.' };
  }
  if (raw === 'RESOURCE_UNAVAILABLE') {
    return { status: 507, code: raw, message: 'The Environment Runner does not have enough available resources.' };
  }
  if (
    raw === 'ENVIRONMENT_LIMIT_EXCEEDED' ||
    raw === 'ENVIRONMENT_PACK_UNAVAILABLE' ||
    raw === 'ENVIRONMENT_RECIPE_NOT_FOUND'
  ) {
    return { status: 422, code: raw, message: 'The requested Environment configuration is unavailable.' };
  }
  if (raw === 'ENVIRONMENT_PACK_FORBIDDEN') {
    return { status: 403, code: raw, message: 'The requested Environment Pack is not allowed by this recipe.' };
  }
  if (
    raw === 'SUBAGENT_PROFILE_NOT_FOUND' ||
    raw === 'DELEGATION_NOT_FOUND' ||
    raw === 'AGENT_RUNTIME_NOT_FOUND' ||
    raw === 'MEMORY_NOT_FOUND' ||
    raw === 'MEMORY_IMPORT_CONFIRMATION_NOT_FOUND'
  ) {
    return { status: 404, code: 'NOT_FOUND', message: 'Agent collaboration resource was not found.' };
  }
  if (
    raw === 'DELEGATION_DEPTH_EXCEEDED' ||
    raw === 'SUBAGENT_MODEL_NOT_ALLOWED' ||
    raw === 'SUBAGENT_MODEL_UNAVAILABLE' ||
    raw === 'DELEGATION_WAIT_CYCLE' ||
    raw === 'DEPENDENCY_NOT_FOUND' ||
    raw === 'DEPENDENCY_FAILED' ||
    raw === 'DELEGATION_DEADLINE_EXCEEDED' ||
    raw === 'DELEGATION_BUDGET_EXCEEDED' ||
    raw === 'RUN_BUDGET_EXCEEDED' ||
    raw === 'MAILBOX_FULL' ||
    raw === 'MAILBOX_BUDGET_EXCEEDED' ||
    raw === 'MAILBOX_HARD_LIMIT_EXCEEDED' ||
    raw === 'MESSAGE_STALE' ||
    raw === 'MESSAGE_RECIPIENT_INVALID' ||
    raw === 'FACT_VERSION_CONFLICT' ||
    raw === 'FACT_QUOTA_EXCEEDED' ||
    raw === 'MEMORY_VERSION_CONFLICT' ||
    raw === 'MEMORY_REVIEW_STATE_INVALID' ||
    raw === 'MEMORY_IMPORT_CONFIRMATION_EXPIRED' ||
    raw === 'MEMORY_IMPORT_SOURCE_CHANGED' ||
    raw === 'MEMORY_NOT_IMPORTABLE' ||
    raw === 'IDEMPOTENCY_KEY_CONFLICT'
  ) {
    return { status: 409, code: raw, message: 'Agent collaboration state changed or cannot accept this operation.' };
  }
  if (raw === 'MESSAGE_TOO_LARGE' || raw === 'FACT_TOO_LARGE' || raw === 'MEMORY_SOURCE_REFS_TOO_LARGE') {
    return { status: 413, code: raw, message: 'Agent collaboration payload is too large.' };
  }
  if (
    raw === 'MESSAGE_PEER_FORBIDDEN' ||
    raw === 'RESOURCE_FORBIDDEN' ||
    raw === 'APP_INTENT_DENIED' ||
    raw === 'ARTIFACT_NOT_AUTHORIZED_FOR_RUN'
  ) {
    return { status: 403, code: raw, message: 'Agent collaboration operation is not authorized.' };
  }
  if (raw === 'SUBAGENT_PROFILE_HARD_LIMIT_EXCEEDED' || raw === 'FACT_KEY_INVALID') {
    return { status: 400, code: raw, message: 'Invalid Agent collaboration configuration.' };
  }
  if (
    raw === 'APP_INTENT_INVALID' ||
    raw === 'APP_INTENT_PAYLOAD_INVALID' ||
    raw === 'APP_INTENT_ARTIFACT_REF_INVALID' ||
    raw === 'APP_INTENT_CONFIRMATION_REQUIRED'
  ) {
    return { status: 400, code: raw, message: 'Invalid AppIntent transfer request.' };
  }
  if (raw === 'APP_INTENT_PAYLOAD_TOO_LARGE') {
    return { status: 413, code: raw, message: 'AppIntent payload is too large.' };
  }
  if (
    raw === 'APP_INTENT_SELF_TRANSFER_DENIED' ||
    raw === 'APP_INTENT_UNDECLARED' ||
    raw === 'APP_INTENT_SCHEMA_MISMATCH' ||
    raw === 'APP_INTENT_SENSITIVE_FIELD_DENIED'
  ) {
    return { status: 422, code: raw, message: 'AppIntent transfer is incompatible with the selected apps.' };
  }
  if (
    raw === 'APP_INTENT_SENDER_GRANT_DENIED' ||
    raw === 'APP_INTENT_RECEIVER_GRANT_DENIED' ||
    raw === 'APP_INTENT_ARTIFACT_NOT_AUTHORIZED'
  ) {
    return { status: 403, code: raw, message: 'AppIntent transfer is not authorized by current grants.' };
  }
  if (raw === 'APP_INTENT_APP_UNAVAILABLE') {
    return { status: 409, code: raw, message: 'An AppIntent participant is not currently available.' };
  }
  if (raw === 'APP_INTENT_ARTIFACT_RANGE_INVALID') {
    return { status: 416, code: raw, message: 'AppIntent Artifact range is not satisfiable.' };
  }
  if (raw === 'APP_INTENT_NOT_FOUND' || raw === 'APP_INTENT_ARTIFACT_NOT_FOUND') {
    return { status: 404, code: 'NOT_FOUND', message: 'AppIntent receipt or Artifact was not found.' };
  }
  if (
    raw === 'PUBLISHER_KEY_INVALID' ||
    raw === 'PUBLISHER_KEY_LABEL_INVALID' ||
    raw === 'PLUGIN_FRONTEND_RPC_INVALID' ||
    raw === 'PLUGIN_PACKAGE_REF_INVALID'
  ) {
    return { status: 400, code: raw, message: 'Invalid Agent plugin request.' };
  }
  if (
    raw === 'PUBLISHER_KEY_NOT_FOUND' ||
    raw === 'PLUGIN_STAGE_NOT_FOUND' ||
    raw === 'PLUGIN_VERSION_NOT_FOUND' ||
    raw === 'PLUGIN_NOT_INSTALLED'
  ) {
    return { status: 404, code: 'NOT_FOUND', message: 'Agent plugin resource was not found.' };
  }
  if (
    raw === 'PLUGIN_STAGE_VERSION_CONFLICT' ||
    raw === 'PLUGIN_VERSION_IMMUTABLE' ||
    raw === 'PLUGIN_UPGRADE_REQUIRED' ||
    raw === 'PLUGIN_INSTALLATION_STATE_CONFLICT' ||
    raw === 'PLUGIN_VERSION_ALREADY_ACTIVE' ||
    raw === 'PLUGIN_MUST_BE_UNINSTALLED' ||
    raw === 'PLUGIN_STAGE_ALREADY_INSTALLED' ||
    raw === 'PLUGIN_STAGE_NOT_VERIFIED' ||
    raw === 'PLUGIN_STAGE_CHANGED' ||
    raw === 'AGENT_APP_DRAINING'
  ) {
    return { status: 409, code: raw, message: 'Agent plugin state changed or cannot accept this operation.' };
  }
  if (
    raw === 'PLUGIN_PACKAGE_TOO_LARGE' ||
    raw === 'PLUGIN_ARCHIVE_TOO_LARGE' ||
    raw === 'PLUGIN_ARCHIVE_FILE_TOO_LARGE' ||
    raw === 'PLUGIN_FILE_LIST_TOO_LARGE' ||
    raw === 'PLUGIN_FRONTEND_RPC_TOO_LARGE'
  ) {
    return { status: 413, code: raw, message: 'Agent plugin payload is too large.' };
  }
  if (
    raw === 'PLUGIN_ARCHIVE_UNSAFE' ||
    raw === 'PLUGIN_ARCHIVE_TOO_DEEP' ||
    raw === 'PLUGIN_ARCHIVE_TOO_MANY_FILES' ||
    raw === 'PLUGIN_ARCHIVE_DUPLICATE_PATH' ||
    raw === 'PLUGIN_CONTROL_FILE_MISSING' ||
    raw === 'PLUGIN_MANIFEST_INVALID' ||
    raw === 'PLUGIN_FILE_LIST_INVALID' ||
    raw === 'PLUGIN_SIGNATURE_INVALID' ||
    raw === 'PLUGIN_PUBLISHER_UNTRUSTED' ||
    raw === 'PLUGIN_PUBLISHER_KEY_MISMATCH' ||
    raw === 'PLUGIN_UNLISTED_FILE' ||
    raw === 'PLUGIN_LISTED_FILE_MISSING' ||
    raw === 'PLUGIN_FILE_MISMATCH' ||
    raw === 'PLUGIN_FILE_HASH_MISMATCH' ||
    raw === 'PLUGIN_RESOURCE_MISSING' ||
    raw === 'PLUGIN_UI_ENTRY_INVALID' ||
    raw === 'PLUGIN_BACKEND_ENTRY_INVALID' ||
    raw === 'PLUGIN_TOO_MANY_SKILLS' ||
    raw === 'PLUGIN_APP_ID_RESERVED' ||
    raw === 'PLUGIN_APP_ID_MISMATCH'
  ) {
    return { status: 422, code: raw, message: 'Agent plugin package failed validation.' };
  }
  if (raw === 'PLUGIN_FRONTEND_RPC_METHOD_DENIED') {
    return { status: 403, code: raw, message: 'Agent plugin UI method is not allowed.' };
  }
  if (raw === 'PLUGIN_RUNTIME_MIGRATION_TOO_LARGE') {
    return { status: 413, code: raw, message: 'Agent plugin migration payload is too large.' };
  }
  if (raw === 'PLUGIN_RUNTIME_IDENTITY_CONFLICT' || raw === 'PLUGIN_RUNTIME_SOURCE_MISMATCH') {
    return {
      status: 409,
      code: raw,
      message: 'Agent plugin runtime identity no longer matches the installed package.',
    };
  }
  if (
    raw === 'PLUGIN_RUNTIME_UNAVAILABLE' ||
    raw === 'PLUGIN_RUNTIME_INSTANCE_MISSING' ||
    raw === 'PLUGIN_RUNTIME_INSTANCE_STOPPED' ||
    raw.startsWith('PLUGIN_RUNTIME_START_') ||
    raw.startsWith('PLUGIN_RUNTIME_CONTROL_') ||
    raw.startsWith('PLUGIN_RUNTIME_PLUGIN_ERROR:') ||
    raw === 'PLUGIN_FRONTEND_ORIGIN_UNAVAILABLE' ||
    raw === 'PLUGIN_FRONTEND_ORIGIN_NOT_ISOLATED'
  ) {
    return {
      status: 503,
      code: raw.split(':')[0]!,
      message: 'Agent plugin runtime or isolated UI origin is unavailable.',
    };
  }
  if (raw === 'STATE_CONFLICT' || raw === 'TARGET_DENYLIST_VERSION_CONFLICT') {
    return { status: 409, code: 'STATE_CONFLICT', message: 'Agent resource changed; refresh and retry.' };
  }
  if (raw === 'TARGET_CONNECTION_NOT_FOUND') {
    return { status: 404, code: 'NOT_FOUND', message: 'One or more target connections were not found.' };
  }
  if (raw === 'NOT_FOUND') return { status: 404, code: 'NOT_FOUND', message: 'Agent resource was not found.' };
  if (raw === 'CURSOR_INVALID') return { status: 400, code: 'CURSOR_INVALID', message: 'Invalid cursor.' };
  if (raw === 'CURSOR_CONFLICT') return { status: 400, code: 'CURSOR_CONFLICT', message: 'Cursor sources disagree.' };
  if (raw === 'CURSOR_AHEAD')
    return { status: 400, code: 'CURSOR_AHEAD', message: 'Cursor is ahead of the durable stream.' };
  if (raw === 'IDEMPOTENCY_KEY_INVALID') {
    return { status: 400, code: 'IDEMPOTENCY_KEY_INVALID', message: 'A UUID Idempotency-Key is required.' };
  }
  if (
    raw === 'IDEMPOTENCY_PAYLOAD_MISMATCH' ||
    raw === 'IDEMPOTENCY_IN_PROGRESS' ||
    raw === 'RECONCILIATION_REQUIRED'
  ) {
    return { status: 409, code: raw, message: 'The idempotent Agent command cannot be applied in its current state.' };
  }
  if (raw === 'BUDGET_INCREASE_INVALID') {
    return { status: 400, code: raw, message: 'Run budget increases must strictly raise the current budget.' };
  }
  if (raw === 'BUDGET_HARD_LIMIT_EXCEEDED') {
    return { status: 422, code: raw, message: 'The requested Run budget exceeds the current Agent Hard Limit.' };
  }
  if (raw === 'CAPABILITY_UNAVAILABLE') {
    return { status: 409, code: raw, message: 'This Agent capability is not enabled in the current phase.' };
  }
  if (raw === 'RUN_DELETE_ACTIVE' || raw === 'RUN_DELETE_REFERENCED' || raw === 'RUN_DELETE_RECONCILIATION_REQUIRED') {
    return { status: 409, code: raw, message: 'The Run cannot be deleted while it is active or still referenced.' };
  }
  if (raw === 'CHECKPOINT_NOT_SAFE' || raw === 'RUN_RESUME_SOURCE_NOT_TERMINAL') {
    return { status: 409, code: raw, message: 'The Run is not at a safe checkpoint or resume boundary.' };
  }
  if (raw === 'CHECKPOINT_ARTIFACT_UNAVAILABLE') {
    return { status: 409, code: raw, message: 'A checkpoint Artifact is unavailable.' };
  }
  if (raw === 'CHECKPOINT_DEFINITION_STALE' || raw === 'CHECKPOINT_PROVIDER_STALE') {
    return { status: 409, code: raw, message: 'The checkpoint runtime configuration has changed.' };
  }
  if (raw === 'CHECKPOINT_PROVIDER_UNAVAILABLE' || raw === 'CHECKPOINT_MODEL_UNAVAILABLE') {
    return { status: 422, code: raw, message: 'The checkpoint model is unavailable.' };
  }
  if (raw === 'CHECKPOINT_TARGET_DENIED') {
    return { status: 403, code: raw, message: 'A checkpoint target is denied by current Host policy.' };
  }
  if (raw === 'CHECKPOINT_INVALID') {
    return { status: 409, code: raw, message: 'The checkpoint is no longer valid.' };
  }
  if (
    raw === 'THREAD_HAS_ACTIVE_RUN' ||
    raw === 'RUN_NOT_ACCEPTING_INPUT' ||
    raw === 'RUN_NOT_AWAITING_BUDGET' ||
    raw === 'RUN_NOT_SCHEDULABLE' ||
    raw === 'RUNTIME_NOT_SCHEDULABLE' ||
    raw === 'INPUT_REVISION_CONFLICT' ||
    raw === 'POLICY_REVISION_CONFLICT' ||
    raw === 'PROVIDER_CONFIGURATION_STALE' ||
    raw === 'AGENT_APP_DISABLED' ||
    raw === 'AGENT_DISABLED'
  ) {
    return { status: 409, code: raw, message: 'Agent runtime state changed; refresh and retry.' };
  }
  if (raw === 'RUN_QUEUE_FULL' || raw === 'SSE_SESSION_LIMIT') {
    return { status: 429, code: raw, message: 'Agent capacity is temporarily exhausted.' };
  }
  if (raw === 'CONTEXT_BUDGET_EXCEEDED' || raw === 'MODEL_PRICE_UNKNOWN') {
    return { status: 422, code: raw, message: 'The selected model cannot satisfy the requested Agent budget.' };
  }
  if (raw === 'AGENT_DEFINITION_NOT_FOUND') {
    return { status: 404, code: 'NOT_FOUND', message: 'Agent definition was not found.' };
  }
  if (raw === 'ARTIFACT_CROSS_APP_ATTACH_REQUIRED') {
    return { status: 409, code: raw, message: 'Cross-App Artifact use requires an explicit Host attach.' };
  }
  if (
    raw === 'ENVIRONMENT_CONTROLLER_UNAVAILABLE' ||
    raw === 'ENVIRONMENT_CONTROLLER_TIMEOUT' ||
    raw === 'ENVIRONMENT_CONTROLLER_AUTH_FAILED' ||
    raw.startsWith('ENVIRONMENT_CONTROLLER_HTTP_')
  ) {
    return {
      status: 503,
      code: 'ENVIRONMENT_CONTROLLER_UNAVAILABLE',
      message: 'Agent Environment Runner is unavailable.',
    };
  }
  if (raw === 'ENVIRONMENT_RECIPE_NOT_FOUND' || raw === 'ENVIRONMENT_RECIPE_UNAVAILABLE') {
    return { status: 404, code: 'NOT_FOUND', message: 'Environment recipe was not found.' };
  }
  if (raw === 'ENVIRONMENT_PACK_UNAVAILABLE') {
    return { status: 422, code: raw, message: 'The requested Environment Pack is unavailable.' };
  }
  if (raw === 'ENVIRONMENT_PACK_FORBIDDEN' || raw === 'ENVIRONMENT_LIMIT_EXCEEDED') {
    return { status: 422, code: raw, message: 'The requested Environment configuration is not allowed.' };
  }
  if (
    raw === 'ENVIRONMENT_PACK_IN_USE' ||
    raw === 'ENVIRONMENT_RECONCILIATION_REQUIRED' ||
    raw === 'ENVIRONMENT_RECREATE_REQUIRED'
  ) {
    return { status: 409, code: raw, message: 'Environment state must be reconciled before this action.' };
  }
  if (raw === 'HARD_LIMIT_CONFIRMATION_REQUIRED') {
    return {
      status: 409,
      code: 'HARD_LIMIT_CONFIRMATION_REQUIRED',
      message: 'Hard Limits require the dedicated confirmation flow.',
    };
  }
  return { status: 500, code: 'INTERNAL_ERROR', message: 'Agent request failed.' };
};

export const agentRoute =
  (handler: AgentAsyncRoute): RequestHandler =>
  (request, response, next) => {
    agentRequestId(request, response);
    void Promise.resolve(handler(request, response, next)).catch((error) => {
      const mapped = mapAgentError(error);
      if (mapped.status === 500) console.error('[Agent HTTP] Unhandled route error:', error);
      if (!response.headersSent) agentError(request, response, mapped.status, mapped.code, mapped.message);
    });
  };
