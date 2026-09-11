import type { AgentErrorRule } from './rule';
import { onCodes, onCodesOrPrefixes, rawCode } from './rule';

export const integrationErrorRules: readonly AgentErrorRule[] = [
  onCodes(['INTEGRATION_NOT_FOUND'], {
    status: 404,
    code: 'NOT_FOUND',
    message: 'Agent integration was not found.',
  }),
  onCodes(['INTEGRATION_VERSION_CONFLICT', 'INTEGRATION_CREDENTIAL_STALE', 'RESOURCE_CHANGED'], {
    status: 409,
    code: 'STATE_CONFLICT',
    message: 'Agent integration changed; refresh and retry.',
  }),
  onCodes(['INTEGRATION_DISABLED'], rawCode(409, 'Agent integration is disabled.')),
  onCodes(
    ['INTEGRATION_REFRESH_UNSUPPORTED', 'MCP_PROTOCOL_VERSION_UNSUPPORTED'],
    rawCode(422, 'The integration protocol is not supported.'),
  ),
  onCodesOrPrefixes(
    ['INTEGRATION_PRIVATE_EXCEPTION_INVALID'],
    ['MCP_', 'INTEGRATION_ENDPOINT_'],
    rawCode(503, 'The integration endpoint is unavailable or unsafe.'),
  ),
];
