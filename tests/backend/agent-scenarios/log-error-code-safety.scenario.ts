import assert from 'node:assert/strict';
import { logErrorCode } from '../../../packages/backend/src/shared/logging/logger';

export const logErrorCodeSafetyScenario = async () => {
  assert.equal(logErrorCode(new Error('STATE_CONFLICT'), 'SAFE_FALLBACK'), 'STATE_CONFLICT');
  assert.equal(
    logErrorCode(new Error('upstream response body contained credential material'), 'SAFE_FALLBACK'),
    'SAFE_FALLBACK',
  );
  assert.equal(
    logErrorCode(Object.assign(new Error('socket failed'), { code: 'ECONNRESET' }), 'SAFE_FALLBACK'),
    'ECONNRESET',
  );
  assert.equal(logErrorCode('opaque failure', 'not-safe'), 'UNEXPECTED_ERROR');
  return [{ name: 'log_error_code_safety_cases', value: 4, unit: 'cases' }];
};
