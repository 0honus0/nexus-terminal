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
  onCodes(['INTEGRATION_REFRESH_STALE'], rawCode(409, 'Agent integration changed during refresh; retry.')),
  onCodes(
    ['INTEGRATION_REFRESH_UNSUPPORTED', 'MCP_PROTOCOL_VERSION_UNSUPPORTED'],
    rawCode(422, 'The integration protocol is not supported.'),
  ),
  onCodes(
    ['INTEGRATION_PRIVATE_EXCEPTION_INVALID', 'INTEGRATION_ENDPOINT_INVALID', 'INTEGRATION_ENDPOINT_SCHEME_DENIED'],
    rawCode(400, 'Invalid integration endpoint configuration.'),
  ),
  onCodes(
    ['INTEGRATION_PRIVATE_ENDPOINT_DENIED', 'INTEGRATION_ENDPOINT_DENIED', 'INTEGRATION_INSECURE_ENDPOINT_DENIED'],
    rawCode(422, 'The integration endpoint is not allowed by network safety policy.'),
  ),
  onCodes(['INTEGRATION_DNS_RESOLUTION_FAILED'], rawCode(503, 'The integration endpoint could not be resolved.')),
  onCodesOrPrefixes(
    [],
    ['MCP_', 'INTEGRATION_ENDPOINT_'],
    rawCode(503, 'The integration endpoint is unavailable or unsafe.'),
  ),
];
