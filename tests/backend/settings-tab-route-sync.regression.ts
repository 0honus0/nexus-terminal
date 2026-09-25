import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  new URL('../../packages/frontend/src/app/pages/settings/SettingsPage.vue', import.meta.url),
  'utf8',
);

assert(source.includes("import { useRoute, useRouter } from 'vue-router';"));
assert(source.includes('const router = useRouter();'));
assert(source.includes('const syncRouteTab = (): void => {'));
assert(source.includes("typeof raw === 'string' && allTabs.value.some((item) => item.value === raw)"));
assert(source.includes(": 'workspace';"));
assert(source.includes('watch(() => route.query.tab, syncRouteTab, { immediate: true });'));
assert(source.includes('onActivated(syncRouteTab);'));
assert(source.includes('void router.replace({ query: { ...route.query, tab } }).catch(() => undefined);'));
assert(!source.includes('onMounted(() => {'));
assert(!source.includes('const tabQuery = route.query.tab as SettingsTab | undefined;'));

process.stdout.write('Settings tab route sync regression: PASS\n');
