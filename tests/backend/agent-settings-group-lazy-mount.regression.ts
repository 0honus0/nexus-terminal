import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  new URL('../../packages/frontend/src/features/agent/settings/AgentSettingsPanel.vue', import.meta.url),
  'utf8',
);

for (const group of ['models', 'tools', 'runtime', 'safety']) {
  assert(
    source.includes(`v-if="visitedGroups.has('${group}')" v-show="activeGroup === '${group}'"`),
    `${group} group must lazy-mount on first visit and remain mounted afterwards`,
  );
}

assert(source.includes("const visitedGroups = reactive(new Set<AgentSettingsGroupId>(['models']));"));
assert(source.includes('visitedGroups.add(id);'));

process.stdout.write('Agent settings group lazy mount regression: PASS\n');
