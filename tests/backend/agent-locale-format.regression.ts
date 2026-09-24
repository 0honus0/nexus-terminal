import assert from 'node:assert/strict';
import {
  formatAgentDate,
  formatAgentDateTime,
  formatAgentNumber,
  formatAgentTime,
} from '../../packages/frontend/src/features/agent/locale-format';
import {
  formatQuantity,
  getQuantityFeedback,
  type QuantityLabels,
} from '../../packages/frontend/src/features/agent/settings/quantity-format';

assert.equal(formatAgentNumber('en-US', 1234567), '1,234,567');
assert.equal(formatAgentNumber('de-DE', 1234567), '1.234.567');
assert.notEqual(
  formatAgentDate('en-US', new Date('2026-09-24T12:34:00Z'), { timeZone: 'UTC' }),
  formatAgentDate('ja-JP', new Date('2026-09-24T12:34:00Z'), { timeZone: 'UTC' }),
);
assert(formatAgentDateTime('en-US', new Date('2026-09-24T12:34:00Z')).length > 0);
assert(formatAgentTime('ja-JP', new Date('2026-09-24T12:34:00Z')).length > 0);

const labels = (locale: string): QuantityLabels => ({
  locale,
  unlimited: 'unlimited',
  seconds: (value) => `${value} s`,
  minutes: (value) => `${value} min`,
  hours: (value) => `${value} h`,
  days: (value) => `${value} d`,
  invalidFormat: 'invalid',
  exactBytes: (value) => `${value} bytes`,
  exactTokens: (value) => `${value} tokens`,
  exactSeconds: (value) => `${value} seconds`,
});

assert.equal(formatQuantity(1234, 'number', labels('en-US')), '1,234');
assert.equal(formatQuantity(1234, 'number', labels('de-DE')), '1.234');
assert.equal(getQuantityFeedback(1234567, 'tokens', labels('en-US')).exact, '1,234,567 tokens');
assert.equal(getQuantityFeedback(1234567, 'tokens', labels('de-DE')).exact, '1.234.567 tokens');
assert.equal(getQuantityFeedback(1234567, 'bytes', labels('de-DE')).exact, '1.234.567 bytes');

process.stdout.write('agent locale formatting regression: PASS\n');
