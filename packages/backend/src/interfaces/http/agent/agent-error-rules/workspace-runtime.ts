import type { AgentErrorRule } from './rule';
import { onCodes, onCodesOrPrefixes, rawCode } from './rule';

export const workspaceRuntimeErrorRules: readonly AgentErrorRule[] = [
  onCodes(['WORKSPACE_RUNTIME_CONFIRMATION_NOT_FOUND'], rawCode(404, 'Workspace Runtime confirmation was not found.')),
  onCodes(
    ['WORKSPACE_RUNTIME_CONFIRMATION_EXPIRED'],
    rawCode(409, 'Workspace Runtime confirmation expired; preview again.'),
  ),
  onCodes(['CATALOG_REVISION_CONFLICT'], rawCode(409, 'Workspace Runtime Catalog changed; refresh and preview again.')),
  onCodes(['WORKSPACE_GENERATION_CONFLICT'], rawCode(409, 'Workspace state changed; refresh and retry.')),
  onCodes(['WORKSPACE_TOOLCHAIN_IN_USE'], rawCode(409, 'The Tool Pack is still used by an active Workspace.')),
  onCodesOrPrefixes(
    ['WORKSPACE_RUNTIME_UNAVAILABLE', 'WORKSPACE_RUNTIME_TIMEOUT', 'WORKSPACE_RUNTIME_AUTH_FAILED'],
    ['WORKSPACE_RUNTIME_HTTP_'],
    {
      status: 503,
      code: 'WORKSPACE_RUNTIME_UNAVAILABLE',
      message: 'Workspace Runtime Runner is unavailable.',
    },
  ),
  onCodes(['RESOURCE_UNAVAILABLE'], rawCode(507, 'Workspace Runtime does not have enough available resources.')),
  onCodes(['WORKSPACE_RECIPE_NOT_FOUND'], {
    status: 404,
    code: 'NOT_FOUND',
    message: 'Workspace recipe was not found.',
  }),
  onCodes(
    ['WORKSPACE_TOOLCHAIN_UNAVAILABLE', 'WORKSPACE_LIMIT_EXCEEDED'],
    rawCode(422, 'The requested Workspace configuration is unavailable.'),
  ),
  onCodes(
    ['WORKSPACE_TOOLCHAIN_FORBIDDEN'],
    rawCode(403, 'The requested Tool Pack is not allowed by this Workspace recipe.'),
  ),
  onCodes(['WORKSPACE_TARGET_NOT_FOUND'], {
    status: 404,
    code: 'NOT_FOUND',
    message: 'Workspace plugin target was not found.',
  }),
  onCodes(
    [
      'WORKSPACE_EXISTS',
      'WORKSPACE_STATE_INVALID',
      'WORKSPACE_RECONCILIATION_REQUIRED',
      'WORKSPACE_TOOLCHAIN_NO_CHANGE',
    ],
    rawCode(409, 'Workspace state changed; refresh and retry.'),
  ),
  onCodes(['WORKSPACE_FILE_TOO_LARGE'], rawCode(413, 'Workspace file exceeds the supported transfer size.')),
];
