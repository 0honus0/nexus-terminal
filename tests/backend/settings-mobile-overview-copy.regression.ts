import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  new URL('../../packages/frontend/src/app/pages/settings/SettingsPage.vue', import.meta.url),
  'utf8',
);

const catalogStart = source.indexOf('data-testid="settings-mobile-catalog"');
assert(catalogStart >= 0);
const catalog = source.slice(catalogStart, source.indexOf('<!-- 主工作区', catalogStart));
assert(catalog.includes("t('settings.mobile.settingsOverview')"));
assert(!catalog.includes("t('settings.descriptions.agent')"));
assert(catalog.includes('t(item.descriptionKey)'));
assert(source.includes("descriptionKey: 'settings.descriptions.agent'"));

process.stdout.write('Settings mobile overview copy regression: PASS\n');
