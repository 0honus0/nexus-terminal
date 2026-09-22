import assert from 'node:assert/strict';
import { agentRoute } from '../../../packages/backend/src/interfaces/http/agent/agent-http';

export const publicAgentErrorTaxonomyScenario = async () => {
  const routeError = async (rawCode: string): Promise<{ status: number; code: string }> =>
    new Promise((resolve, reject) => {
      let status = 0;
      const response = {
        locals: {},
        headersSent: false,
        setHeader: () => response,
        status: (value: number) => {
          status = value;
          return response;
        },
        json: (body: unknown) => {
          try {
            const error = (body as { error?: { code?: unknown } }).error;
            assert.ok(error && typeof error.code === 'string');
            resolve({ status, code: error.code });
          } catch (error) {
            reject(error);
          }
          return response;
        },
      };
      const request = { header: () => undefined };
      agentRoute(async () => {
        throw new Error(rawCode);
      })(request as never, response as never, (() => undefined) as never);
    });

  const cases: Array<{ producer: string; raw: string; status: number; code: string }> = [
    {
      producer: 'capability grant scope validation',
      raw: 'APP_GRANT_SCOPE_INVALID',
      status: 400,
      code: 'VALIDATION_FAILED',
    },
    { producer: 'subagent missing run', raw: 'RUN_NOT_FOUND', status: 404, code: 'NOT_FOUND' },
    { producer: 'subagent terminal run', raw: 'RUN_NOT_ACTIVE', status: 409, code: 'RUN_NOT_ACTIVE' },
    {
      producer: 'subagent stale cancel',
      raw: 'DELEGATION_VERSION_CONFLICT',
      status: 409,
      code: 'DELEGATION_VERSION_CONFLICT',
    },
    {
      producer: 'workspace ACP selection',
      raw: 'ACP_PROFILE_SELECTION_INVALID',
      status: 400,
      code: 'ACP_PROFILE_SELECTION_INVALID',
    },
    { producer: 'workspace ACP missing', raw: 'ACP_PROFILE_NOT_FOUND', status: 404, code: 'NOT_FOUND' },
    {
      producer: 'provider explicit capability metadata',
      raw: 'PROVIDER_CAPABILITY_METADATA_INVALID',
      status: 502,
      code: 'PROVIDER_CAPABILITY_METADATA_INVALID',
    },
    { producer: 'workspace browser missing', raw: 'BROWSER_TARGET_NOT_FOUND', status: 404, code: 'NOT_FOUND' },
    {
      producer: 'workspace browser incompatible',
      raw: 'BROWSER_TARGET_REQUIRES_BROWSER_RECIPE',
      status: 422,
      code: 'BROWSER_TARGET_REQUIRES_BROWSER_RECIPE',
    },
    {
      producer: 'plugin storage CAS',
      raw: 'APP_STORAGE_VERSION_CONFLICT',
      status: 409,
      code: 'APP_STORAGE_VERSION_CONFLICT',
    },
    {
      producer: 'plugin storage payload',
      raw: 'APP_STORAGE_VALUE_TOO_LARGE',
      status: 413,
      code: 'APP_STORAGE_VALUE_TOO_LARGE',
    },
    {
      producer: 'plugin storage quota',
      raw: 'APP_STORAGE_QUOTA_EXCEEDED',
      status: 507,
      code: 'APP_STORAGE_QUOTA_EXCEEDED',
    },
    { producer: 'workspace artifact import', raw: 'ARTIFACT_NOT_READY', status: 409, code: 'ARTIFACT_NOT_READY' },
    {
      producer: 'per-Run artifact quota',
      raw: 'ARTIFACT_RUN_QUOTA_EXCEEDED',
      status: 507,
      code: 'ARTIFACT_QUOTA_EXCEEDED',
    },
    {
      producer: 'checkpoint model capability contract',
      raw: 'CHECKPOINT_MODEL_CAPABILITY_UNSUPPORTED',
      status: 422,
      code: 'CHECKPOINT_MODEL_CAPABILITY_UNSUPPORTED',
    },
    {
      producer: 'MCP endpoint syntax',
      raw: 'INTEGRATION_ENDPOINT_INVALID',
      status: 400,
      code: 'INTEGRATION_ENDPOINT_INVALID',
    },
    {
      producer: 'MCP private endpoint policy',
      raw: 'INTEGRATION_PRIVATE_ENDPOINT_DENIED',
      status: 422,
      code: 'INTEGRATION_PRIVATE_ENDPOINT_DENIED',
    },
    {
      producer: 'MCP DNS unavailable',
      raw: 'INTEGRATION_DNS_RESOLUTION_FAILED',
      status: 503,
      code: 'INTEGRATION_DNS_RESOLUTION_FAILED',
    },
  ];
  for (const expected of cases) {
    const actual = await routeError(expected.raw);
    assert.deepEqual(actual, { status: expected.status, code: expected.code }, expected.producer);
    assert.notEqual(actual.status, 500, `${expected.producer} must not degrade to INTERNAL_ERROR`);
  }

  const durableStateFaults = ['AGENT_DURABLE_STATE_INVALID', 'SUBAGENT_DURABLE_STATE_INVALID'] as const;
  for (const code of durableStateFaults) {
    assert.deepEqual(
      await routeError(code),
      { status: 500, code },
      `${code} must preserve a stable public diagnostic code while remaining a server fault`,
    );
  }
  assert.deepEqual(
    await routeError('UNMAPPED_INTERNAL_SECRET'),
    { status: 500, code: 'INTERNAL_ERROR' },
    'unknown internal errors must remain masked',
  );

  return [
    { name: 'public_error_contract_cases', value: cases.length, unit: 'cases' },
    { name: 'public_errors_degraded_to_500', value: 0, unit: 'cases' },
    { name: 'public_durable_state_fault_codes', value: durableStateFaults.length, unit: 'cases' },
    { name: 'masked_unknown_internal_errors', value: 1, unit: 'cases' },
    { name: 'public_error_status_classes', value: new Set(cases.map((item) => item.status)).size, unit: 'statuses' },
  ];
};
