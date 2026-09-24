import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), 'utf8');

const panel = read('packages/frontend/src/features/agent/settings/AgentSettingsPanel.vue');
assert(
  panel.includes('const reconcileConflict = async (locks: readonly SettingsOperationLock[]): Promise<boolean> =>'),
);
assert(panel.includes("if (locks.includes('settings-write'))"));
assert(panel.includes("if (locks.includes('providers'))"));
assert(panel.includes("if (locks.includes('apps'))"));
assert(panel.includes("if (locks.includes('denylist'))"));
assert(panel.includes('const reconciled = error.status === 409 ? await reconcileConflict(locks) : false;'));
assert(panel.includes('settings.value = next;\n          hardLimitPreview.value = null;'));
assert(panel.includes("message: reconciled ? t('agent.settings.conflictReloaded') : message(cause)"));

const safety = read('packages/frontend/src/features/agent/settings/SafetyNetworkSettings.vue');
assert(safety.includes('const baselineIds = ref<Set<number>>(new Set());'));
assert(safety.includes("const baselineReason = ref('');"));
assert(safety.includes('if (!isDirty.value || draftMatchesRemote()) syncDenylist();'));
assert(
  !safety.includes(
    'selectedIds.value = new Set(props.denylist.list.map((entry) => entry.connectionId));\n      reason.value',
  ),
);

process.stdout.write('settings conflict reconcile regression: PASS\n');
