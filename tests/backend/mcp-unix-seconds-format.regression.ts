import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dateFromUnixSeconds } from '../../packages/frontend/src/features/agent/locale-format';

const known = dateFromUnixSeconds(1_704_067_200);
assert(known);
assert.equal(known.toISOString(), '2024-01-01T00:00:00.000Z');
assert.equal(known.getTime(), 1_704_067_200_000);
assert.equal(dateFromUnixSeconds(null), null);
assert.equal(dateFromUnixSeconds(undefined), null);
assert.equal(dateFromUnixSeconds(Number.NaN), null);

const component = fs.readFileSync(
  new URL('../../packages/frontend/src/features/agent/settings/McpIntegrationSettings.vue', import.meta.url),
  'utf8',
);
assert(component.includes("import { dateFromUnixSeconds, formatAgentTime } from '../locale-format';"));
assert(component.includes('const date = dateFromUnixSeconds(timestamp);'));
assert(!component.includes('new Date(timestamp)'));

const protocol = fs.readFileSync(new URL('../../packages/protocol/src/agent-integrations.ts', import.meta.url), 'utf8');
assert(protocol.includes('Unix epoch seconds for the latest refresh attempt/success and scheduled retry.'));

process.stdout.write('MCP Unix-seconds timestamp regression: PASS\n');
