import type { AgentErrorRule } from './rule';
import { onCodes, onPrefixes, rawCode } from './rule';

export const providerErrorRules: readonly AgentErrorRule[] = [
  onCodes(['PROVIDER_ENDPOINT_INVALID'], {
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
  onCodes(['PROVIDER_UNAVAILABLE'], {
    status: 503,
    code: 'PROVIDER_UNAVAILABLE',
    message: 'Provider is unavailable.',
  }),
  onCodes(
    [
      'MODEL_NOT_FOUND',
      'MODEL_CAPABILITY_UNSUPPORTED',
      'MODEL_REASONING_EFFORT_UNSUPPORTED',
      'MODEL_OUTPUT_LIMIT_EXCEEDED',
      'MODEL_CAPABILITY_INCOMPLETE',
      'MODEL_CAPABILITY_INVALID',
      'MODEL_TOOL_ARGUMENTS_INVALID',
      'MODEL_TOOL_ARGUMENTS_TOO_LARGE',
      'MODEL_TOOL_RESULT_INVALID',
    ],
    {
      status: 422,
      code: 'MODEL_CAPABILITY_UNSUPPORTED',
      message: 'Model capability is unavailable.',
    },
  ),
  onCodes(['PROVIDER_AUTH_FAILED'], rawCode(422, 'Provider credentials were rejected.')),
  onCodes(['PROVIDER_DISCOVERY_TIMEOUT', 'PROVIDER_TEST_TIMEOUT'], rawCode(503, 'Provider model discovery timed out.')),
  onCodes(
    ['PROVIDER_MODELS_RESPONSE_INVALID', 'PROVIDER_MODELS_RESPONSE_TOO_LARGE', 'PROVIDER_CAPABILITY_METADATA_INVALID'],
    rawCode(502, 'Provider returned an invalid model catalog.'),
  ),
  onPrefixes(['PROVIDER_HTTP_'], rawCode(502, 'Provider returned an error response.')),
  onCodes(['MODEL_REGISTRY_UPDATE_TIMEOUT'], rawCode(503, 'Model registry update timed out.')),
  onCodes(
    ['MODEL_REGISTRY_RESPONSE_INVALID', 'MODEL_REGISTRY_RESPONSE_TOO_LARGE'],
    rawCode(502, 'Model registry returned an invalid catalog.'),
  ),
  onPrefixes(['MODEL_REGISTRY_HTTP_'], rawCode(502, 'Model registry returned an error response.')),
  onCodes(
    ['MODEL_REGISTRY_UPDATE_FAILED', 'MODEL_REGISTRY_CACHE_SAVE_FAILED'],
    rawCode(500, 'Model registry update failed.'),
  ),
  onCodes(['PROVIDER_CONFIGURATION_STALE'], rawCode(409, 'Agent runtime state changed; refresh and retry.')),
];
