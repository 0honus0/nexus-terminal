import assert from 'node:assert/strict';
import { AgentApiError, formatAgentApiError } from '../../packages/frontend/src/features/agent/api/agent-api-error';

const t = (key: string): string => `T:${key}`;
const fallback = 'LOCAL_FALLBACK';

const http = (code: string, message: string, status = 409) => new AgentApiError({ code, message, status });

assert.equal(
  formatAgentApiError(http('SETTINGS_VERSION_CONFLICT', 'Agent settings changed; refresh and retry.'), fallback, t),
  'T:agent.apiErrors.conflict',
);
assert.equal(
  formatAgentApiError(http('PROVIDER_NOT_FOUND', 'Agent resource was not found.', 404), fallback, t),
  'T:agent.apiErrors.notFound',
);
assert.equal(
  formatAgentApiError(http('PROVIDER_UNAVAILABLE', 'Provider is unavailable.'), fallback, t),
  'T:agent.apiErrors.unavailable',
);
assert.equal(
  formatAgentApiError(http('ARTIFACT_QUOTA_EXCEEDED', 'Artifact storage quota is exhausted.', 429), fallback, t),
  'T:agent.apiErrors.quota',
);
assert.equal(
  formatAgentApiError(
    http('PLUGIN_FRONTEND_RPC_METHOD_DENIED', 'Agent plugin UI method is not allowed.', 403),
    fallback,
    t,
  ),
  'T:agent.apiErrors.forbidden',
);
assert.equal(
  formatAgentApiError(http('PROVIDER_TEST_TIMEOUT', 'Provider test timed out.', 504), fallback, t),
  'T:agent.apiErrors.timeout',
);
assert.equal(
  formatAgentApiError(http('VALIDATION_FAILED', 'Invalid Agent request.', 422), fallback, t),
  'T:agent.apiErrors.validation',
);
assert.equal(
  formatAgentApiError(http('SOME_NEW_BACKEND_CODE', 'Future backend English copy.', 400), fallback, t),
  fallback,
);
assert.equal(formatAgentApiError(new Error('Local browser failure'), fallback, t), 'Local browser failure');

process.stdout.write('agent api error locale regression: PASS\n');
