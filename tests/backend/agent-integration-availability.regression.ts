import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relativePath: string): string =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');

const functionSlice = (source: string, startMarker: string, endMarker: string): string => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert(start >= 0 && end > start, `expected source slice ${startMarker} -> ${endMarker}`);
  return source.slice(start, end);
};

const assertGenerationGuard = (source: string, kind: 'mcp' | 'acp'): void => {
  const load = functionSlice(source, 'const loadIntegrations = async', 'const run = async');
  assert(
    load.includes('const generation = ++integrationsGeneration;'),
    `${kind}: each load must advance integration generation`,
  );
  assert(
    load.includes('generation !== integrationsGeneration || !props.agentAvailable'),
    `${kind}: stale or unavailable responses must not commit`,
  );
  assert(
    load.includes('if (generation === integrationsGeneration) loading.value = false;'),
    `${kind}: stale requests must not clear the current loading state`,
  );

  const availabilityWatch = functionSlice(
    source,
    'watch(\n    () => props.agentAvailable',
    '</script>',
  );
  assert(
    availabilityWatch.includes('{ immediate: true }'),
    `${kind}: availability watch must initialize and reload automatically`,
  );
  assert(
    availabilityWatch.includes('void loadIntegrations();'),
    `${kind}: availability changes must trigger integration reconciliation`,
  );
};

const mcp = read('packages/frontend/src/features/agent/settings/McpIntegrationSettings.vue');
assertGenerationGuard(mcp, 'mcp');
assert(
  mcp.includes('const disabled = computed(() => props.busy || localBusy.value || !props.agentAvailable);'),
  'mcp: all mutation controls must disable when Agent is unavailable',
);
assert(
  functionSlice(mcp, 'const submitAddModal = async', 'const toggleIntegration =').includes(
    'if (disabled.value) return;',
  ),
  'mcp: create handler must reject an availability flip even if the modal was already open',
);
assert(
  !mcp.includes('onMounted(() => {\n    void loadIntegrations();'),
  'mcp: mount-only loading must be replaced by lifecycle watch',
);

const acp = read('packages/frontend/src/features/agent/settings/AcpRuntimeSettings.vue');
assertGenerationGuard(acp, 'acp');
assert(
  acp.includes('const integrationDisabled = computed(() => disabled.value || !props.agentAvailable);'),
  'acp: integration mutations need an availability-specific disabled boundary',
);
assert(
  functionSlice(acp, 'const run = async', 'const normalizeProfiles =').includes(
    'if (integrationDisabled.value) return;',
  ),
  'acp: integration mutation runner must reject unavailable Agent state',
);

const profileSection = functionSlice(acp, '<!-- 模块 1：ACP 运行时', '<!-- 模块 2：ACP 集成');
assert(
  profileSection.includes(':disabled="disabled"'),
  'acp: profile settings must keep their normal settings-level disabled policy',
);
assert(
  !profileSection.includes('integrationDisabled'),
  'acp: Agent integration availability must not disable unrelated ACP profile editing',
);

const integrationSection = functionSlice(acp, '<!-- 模块 2：ACP 集成', '<!-- 弹窗 1：添加 ACP 配置档');
assert(
  integrationSection.includes(':disabled="integrationDisabled"'),
  'acp: existing integration controls must disable while unavailable',
);
assert(
  !integrationSection.includes(':disabled="disabled"'),
  'acp: integration controls must not omit the availability boundary',
);

const integrationModal = functionSlice(acp, '<!-- 弹窗 2：添加 ACP 集成', '</template>');
assert(
  integrationModal.includes(':disabled="integrationDisabled || !integrationForm.displayName.trim()'),
  'acp: an already-open integration modal must not submit after Agent becomes unavailable',
);

process.stdout.write('agent integration availability regression: PASS\n');
