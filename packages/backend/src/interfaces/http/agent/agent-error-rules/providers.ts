import type { AgentErrorRule } from './rule';
import { onCodes, onPrefixes, rawCode } from './rule';

export const providerErrorRules: readonly AgentErrorRule[] = [
  onCodes(['PROVIDER_ENDPOINT_INVALID', 'PROVIDER_PRIVATE_EXCEPTION_INVALID'], {
    status: 400,
    code: 'VALIDATION_FAILED',
    message: 'Invalid Agent request.',
  }),
  onCodes(['PROVIDER_NOT_FOUND'], {
    status: 404,
    code: 'NOT_FOUND',
    message: 'Agent resource was not found.',
  }),
  onCodes(['PROVIDER_VERSION_CONFLICT'], {
    status: 409,
    code: 'STATE_CONFLICT',
    message: 'Agent resource changed; refresh and retry.',
  }),
  onCodes(
    [
      'PROVIDER_ENDPOINT_DENIED',
      'PROVIDER_PRIVATE_ENDPOINT_DENIED',
      'PROVIDER_INSECURE_ENDPOINT_DENIED',
      'PROVIDER_ENDPOINT_SCHEME_DENIED',
    ],
    { status: 403, code: 'RESOURCE_FORBIDDEN', message: 'Provider endpoint is not allowed.' },
  ),
  onCodes(['PROVIDER_DNS_RESOLUTION_FAILED', 'PROVIDER_UNAVAILABLE'], {
    status: 503,
    code: 'PROVIDER_UNAVAILABLE',
    message: 'Provider is unavailable.',
  }),
  onCodes(['MODEL_NOT_FOUND', 'MODEL_CAPABILITY_UNSUPPORTED', 'MODEL_OUTPUT_LIMIT_EXCEEDED'], {
    status: 422,
    code: 'MODEL_CAPABILITY_UNSUPPORTED',
    message: 'Model capability is unavailable.',
  }),
  onCodes(['PROVIDER_AUTH_FAILED'], rawCode(422, 'Provider credentials were rejected.')),
  onCodes(['PROVIDER_REDIRECT_DENIED'], rawCode(403, 'Provider redirects are not allowed.')),
  onCodes(
    ['PROVIDER_DISCOVERY_TIMEOUT', 'PROVIDER_HEADERS_TIMEOUT', 'PROVIDER_IDLE_TIMEOUT'],
    rawCode(503, 'Provider model discovery timed out.'),
  ),
  onCodes(
    ['PROVIDER_MODELS_RESPONSE_INVALID', 'PROVIDER_MODELS_RESPONSE_TOO_LARGE'],
    rawCode(502, 'Provider returned an invalid model catalog.'),
  ),
  onPrefixes(['PROVIDER_HTTP_'], rawCode(502, 'Provider returned an error response.')),
  onCodes(['PROVIDER_CONFIGURATION_STALE'], rawCode(409, 'Agent runtime state changed; refresh and retry.')),
];
