import assert from 'node:assert/strict';
import fs from 'node:fs';
import { collectAgentI18nReferences } from '../../scripts/check-agent-i18n.mjs';

const dummy = collectAgentI18nReferences("const unused = 'agent.settings.groups.fake';");
assert.equal(dummy.literals.has('agent.settings.groups.fake'), false);

const commentOnly = collectAgentI18nReferences(
  "// t('agent.settings.groups.fake')\n/* $t('agent.settings.groups.fake') */",
);
assert.equal(commentOnly.literals.has('agent.settings.groups.fake'), false);

const direct = collectAgentI18nReferences('t(\'agent.settings.groups.models\'); $t("agent.settings.groups.runtime");');
assert.equal(direct.literals.has('agent.settings.groups.models'), true);
assert.equal(direct.literals.has('agent.settings.groups.runtime'), true);

const keyed = collectAgentI18nReferences(
  "const card = { titleKey: 'agent.ui.saved', key: 'agent.operations.requestFailed' };",
);
assert.equal(keyed.literals.has('agent.ui.saved'), true);
assert.equal(keyed.literals.has('agent.operations.requestFailed'), true);

const dynamic = collectAgentI18nReferences('t(`agent.settings.feature.stateLabels.${state}`)');
assert.equal(dynamic.prefixes.has('agent.settings.feature.stateLabels'), true);

const ternaryCall = collectAgentI18nReferences(
  "$t(expanded ? 'agent.settings.safety.collapseTargets' : 'agent.settings.safety.manageTargets')",
);
assert.equal(ternaryCall.literals.has('agent.settings.safety.collapseTargets'), true);
assert.equal(ternaryCall.literals.has('agent.settings.safety.manageTargets'), true);

const ternaryKey = collectAgentI18nReferences(
  "{ key: created ? 'agent.conversation.toolSummary.fileCreated' : 'agent.conversation.toolSummary.fileReplaced' }",
);
assert.equal(ternaryKey.literals.has('agent.conversation.toolSummary.fileCreated'), true);
assert.equal(ternaryKey.literals.has('agent.conversation.toolSummary.fileReplaced'), true);

const runtimeMapping = collectAgentI18nReferences("{ label: 'agent.settings.groups.models' }");
assert.equal(runtimeMapping.literals.has('agent.settings.groups.models'), true);

const panel = fs.readFileSync(
  new URL('../../packages/frontend/src/features/agent/settings/AgentSettingsPanel.vue', import.meta.url),
  'utf8',
);
assert.equal(panel.includes("_legacyPluginGroupKey = 'agent.settings.groups.plugins'"), false);
for (const locale of ['en-US', 'ja-JP', 'zh-CN']) {
  const dictionary = JSON.parse(
    fs.readFileSync(new URL(`../../packages/frontend/src/features/agent/i18n/${locale}.json`, import.meta.url), 'utf8'),
  );
  assert.equal(dictionary.agent?.settings?.groups?.plugins, undefined, `${locale} retained groups.plugins`);
}

process.stdout.write('Agent i18n reachability regression: PASS\n');
