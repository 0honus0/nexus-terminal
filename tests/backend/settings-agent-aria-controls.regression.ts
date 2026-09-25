import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  new URL('../../packages/frontend/src/app/pages/settings/SettingsPage.vue', import.meta.url),
  'utf8',
);

assert(source.includes(':aria-controls="`settings-panel-${item.value}`"'));
assert(source.includes('id="settings-panel-agent"'));
assert(source.includes('<AgentSettingsPanel'));
assert(source.includes('v-if="visited.has(\'agent\')"'));
assert(source.includes('v-show="active === \'agent\'"'));

process.stdout.write('Settings Agent aria-controls regression: PASS\n');
