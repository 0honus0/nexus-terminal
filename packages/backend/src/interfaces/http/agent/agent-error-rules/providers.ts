import type { AgentErrorRule } from './rule';
import { onCodes, rawCode } from './rule';

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
  onCodes(['PROVIDER_CONFIGURATION_STALE'], rawCode(409, 'Agent runtime state changed; refresh and retry.')),
];
