import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  new URL('../../packages/frontend/src/app/pages/settings/SettingsPage.vue', import.meta.url),
  'utf8',
);

assert(source.includes("type TabSurface = 'mobile' | 'desktop';"));
assert(source.includes("type TabOrientation = 'horizontal' | 'vertical';"));
assert(source.includes(':tabindex="active === item.value ? 0 : -1"'));
assert(source.includes("@keydown=\"handleTabKeydown($event, item.value, 'horizontal', 'mobile')\""));
assert(source.includes("@keydown=\"handleTabKeydown($event, item.value, 'vertical', 'desktop')\""));
assert(source.includes('aria-orientation="vertical"'));
assert(source.includes("event.key === 'ArrowRight'"));
assert(source.includes("event.key === 'ArrowLeft'"));
assert(source.includes("event.key === 'ArrowDown'"));
assert(source.includes("event.key === 'ArrowUp'"));
assert(source.includes("event.key === 'Home'"));
assert(source.includes("event.key === 'End'"));
assert(source.includes('event.preventDefault();'));
assert(source.includes('requestAnimationFrame(() => document.getElementById(tabElementId(surface, tab))?.focus())'));

for (const tab of ['workspace', 'system', 'security', 'ipControl', 'data', 'appearance', 'agent', 'about']) {
  assert(source.includes(`id="settings-panel-${tab}"`), `missing panel id for ${tab}`);
  assert(source.includes(`:aria-label="tabLabel('${tab}')"`), `missing accessible panel label for ${tab}`);
}
assert.equal((source.match(/role="tabpanel"/g) ?? []).length, 8);

process.stdout.write('Settings tabs accessibility regression: PASS\n');
