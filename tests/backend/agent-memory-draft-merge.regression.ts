import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../../packages/frontend/src/features/agent/settings/MemorySettings.vue', import.meta.url),
  'utf8',
);

const slice = (startMarker: string, endMarker: string): string => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert(start >= 0 && end > start, `expected source slice ${startMarker} -> ${endMarker}`);
  return source.slice(start, end);
};

const loadMemories = slice('const loadMemories = async', 'const loadSourceMemories = async');
assert(loadMemories.includes('const previousBaseline = memoryBaselines.value[memory.id];'));
assert(loadMemories.includes('const wasDirty ='));
assert(
  loadMemories.includes('const serverChanged = previousBaseline !== undefined && previousBaseline !== memory.content;'),
);
assert(
  loadMemories.includes('if (!wasDirty) {\n          nextDrafts[memory.id] = memory.content;'),
  'clean drafts must follow the authoritative refresh',
);
assert(
  loadMemories.includes('} else if (serverChanged) {\n          nextConflicts[memory.id] = true;'),
  'dirty drafts must be preserved and marked conflicted when the server changes',
);
assert(
  loadMemories.includes('if (draftsAppId !== appId) {'),
  'draft state must be isolated when the selected App changes',
);

const loadSources = slice('const loadSourceMemories = async', 'const reconcileSelection =');
const preRequest = loadSources.slice(0, loadSources.indexOf('await agentApi.memories'));
assert(
  !preRequest.includes("sourceMemoryId.value = '';"),
  'same-App source refresh must not clear the selected Memory before authoritative results arrive',
);
assert(
  !preRequest.includes('importPreview.value = null;'),
  'same-App source refresh must not clear an existing import preview before authoritative results arrive',
);
assert(
  loadSources.includes('const selectedSource = filtered.find((memory) => memory.id === sourceMemoryId.value) ?? null;'),
  'source selection must be reconciled against the refreshed valid list',
);
assert(
  loadSources.includes(
    "if (!selectedSource) {\n          sourceMemoryId.value = '';\n          importPreview.value = null;",
  ),
  'selection/preview may be cleared only after the selected source is authoritatively absent',
);
assert(
  loadSources.includes('importPreview.value.sourceVersion !== selectedSource.version'),
  'a preview must be invalidated when its selected source version changes',
);
const sourceCatch = loadSources.slice(loadSources.indexOf('} catch (cause) {'));
assert(
  !sourceCatch.includes('sourceMemories.value = [];'),
  'a transient source refresh failure must not erase the last authoritative list or selection',
);

const sourceWatch = slice('watch(sourceAppId,', 'const onMemoryChanged');
assert(
  sourceWatch.includes('if (nextAppId !== previousAppId) {'),
  'source selection reset must be scoped to an actual source App change',
);
assert(
  sourceWatch.includes("sourceMemoryId.value = '';") && sourceWatch.includes('importPreview.value = null;'),
  'changing source App must clear the old source selection and preview',
);

assert(source.includes('const draftConflict = (memoryId: string): boolean =>'));
assert(source.includes('@click="useLatestDraft(memory)"'));
assert(source.includes("$t('agent.settings.memory.draftConflict')"));

process.stdout.write('agent memory draft merge regression: PASS\n');
