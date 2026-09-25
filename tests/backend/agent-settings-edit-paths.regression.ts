import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

const browser = read('../../packages/frontend/src/features/agent/settings/BrowserRuntimeSettings.vue');
assert(browser.includes('const openEditTargetModal = (target: BrowserTarget): void =>'));
assert(browser.includes('nextTargets[index] = { ...current, id, allowedUrlPatterns };'));
assert(browser.includes('@click="openEditTargetModal(target)"'));
assert(browser.includes('const openEditEndpointModal = (target: BrowserTarget, endpointIndex: number): void =>'));
assert(browser.includes('target.endpoints[editingEndpointIndex.value] = nextEndpoint'));
assert(browser.includes('@click="openEditEndpointModal(target, endpointIndex)"'));
for (const field of ['scope', 'via', 'url', 'priority', 'allowPlaintext', 'verifyTls']) {
  assert(browser.includes(`${field}:`), `missing Browser endpoint field ${field}`);
}

const acp = read('../../packages/frontend/src/features/agent/settings/AcpRuntimeSettings.vue');
assert(acp.includes('const openEditProfileModal = (profile: ProfileDraft): void =>'));
assert(acp.includes('profileForm.commandInput = profile.argvText;'));
assert(acp.includes('editingProfileIdLocked.value = integrations.value.some('));
assert(acp.includes(':disabled="editingProfileIdLocked"'));
assert(acp.includes('@click="openEditProfileModal(profile)"'));
assert(acp.includes('profiles.value.map((profile) => (profile.id === editingProfileId.value ? nextDraft : profile))'));

const mcp = read('../../packages/frontend/src/features/agent/settings/McpIntegrationSettings.vue');
assert(mcp.includes('const openEditModal = (integration: AgentIntegrationViewDto): void =>'));
assert(mcp.includes('@click="openEditModal(integration)"'));
assert(mcp.includes('if (editingIntegration.value) {'));
assert(mcp.includes('await agentApi.updateIntegration(DEFAULT_AGENT_APP_ID, existing, {'));
assert(mcp.includes('...configuration,'));
assert(mcp.includes('endpoint: url,'));
assert(mcp.includes('trustToolAnnotations: form.trustToolAnnotations,'));
assert(mcp.includes('...(credential ? { credential } : {}),'));

process.stdout.write('Agent settings edit paths regression: PASS\n');
