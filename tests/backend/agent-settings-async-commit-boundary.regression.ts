import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

const panel = read('../../packages/frontend/src/features/agent/settings/AgentSettingsPanel.vue');
assert(panel.includes('const patchSection = async ('));
assert(panel.includes('): Promise<boolean> =>'));
assert(panel.includes('await execute<boolean>('));
assert(panel.includes('return true;'));
assert(panel.includes(':save-fallback-models="setFallbackModels"'));
assert(panel.includes(':save="saveBrowserSettings"'));
assert(panel.includes(':save-profiles="saveAcpProfiles"'));
assert(!panel.includes('@fallback-models="setFallbackModels"'));
assert(!panel.includes('@save-profiles="'));

const browser = read('../../packages/frontend/src/features/agent/settings/BrowserRuntimeSettings.vue');
assert(browser.includes('save: ('));
assert(browser.includes(') => Promise<boolean>;'));
assert(browser.includes('const saved = await props.save('));
assert(browser.includes('if (saved) targetModalOpen.value = false;'));
assert(browser.includes('if (saved) endpointModalOpen.value = false;'));
assert(!browser.includes("emit('save'"));
assert(!browser.includes('operationFeedback.notifySuccess'));

const acp = read('../../packages/frontend/src/features/agent/settings/AcpRuntimeSettings.vue');
assert(acp.includes('saveProfiles: (profiles: Profile[], success?: string | null) => Promise<boolean>;'));
assert(acp.includes('const saved = await props.saveProfiles('));
assert(acp.includes('if (!saved) return;'));
assert(acp.includes('if (saved) profiles.value = nextProfiles;'));
assert(!acp.includes("emit('saveProfiles'"));

const model = read('../../packages/frontend/src/features/agent/settings/ModelProviderSettings.vue');
assert(model.includes('saveFallbackModels: ('));
assert(model.includes('await props.saveFallbackModels('));
assert(model.includes('return props.saveFallbackModels(next, null);'));
assert(!model.includes("emit('fallbackModels'"));
assert(!model.includes("operationFeedback.notifySuccess(t('agent.settings.providers.saveNoticeFallback'))"));

process.stdout.write('Agent settings async commit boundary regression: PASS\n');
