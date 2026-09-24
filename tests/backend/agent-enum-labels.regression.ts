import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatAgentEnumLabel } from '../../packages/frontend/src/features/agent/enum-labels';

const translate = ((key: string, named?: Record<string, unknown>): string => {
  if (key === 'agent.enumLabels.technicalState') return `TECH:${String(named?.value ?? '')}`;
  return `T:${key}`;
}) as Parameters<typeof formatAgentEnumLabel>[0];

assert.equal(formatAgentEnumLabel(translate, 'goalStatus', 'in_progress'), 'T:agent.enumLabels.goalStatus.in_progress');
assert.equal(formatAgentEnumLabel(translate, 'ledgerKind', 'tool_result'), 'T:agent.enumLabels.ledgerKind.tool_result');
assert.equal(formatAgentEnumLabel(translate, 'workspaceKind', 'browser'), 'T:agent.enumLabels.workspaceKind.browser');
assert.equal(formatAgentEnumLabel(translate, 'packStatus', 'deprecated'), 'T:agent.enumLabels.packStatus.deprecated');
assert.equal(
  formatAgentEnumLabel(translate, 'subagentMessageKind', 'evidence'),
  'T:agent.enumLabels.subagentMessageKind.evidence',
);
assert.equal(
  formatAgentEnumLabel(translate, 'subagentMessageStatus', 'consumed'),
  'T:agent.enumLabels.subagentMessageStatus.consumed',
);
assert.equal(formatAgentEnumLabel(translate, 'goalStatus', 'future_state'), 'TECH:future_state');

const root = new URL('../../', import.meta.url);
const read = (relativePath: string): string => readFileSync(new URL(relativePath, root), 'utf8');

const taskRail = read('packages/frontend/src/features/agent/runtime/TaskRail.vue');
assert(!taskRail.includes('{{ detailSnapshot.goalStatus }}'));
assert(!taskRail.includes('· {{ entry.kind }}'));
assert(taskRail.includes("formatAgentEnumLabel(t, 'goalStatus', detailSnapshot.goalStatus)"));
assert(taskRail.includes("formatAgentEnumLabel(t, 'ledgerKind', entry.kind)"));

const settings = read('packages/frontend/src/features/agent/settings/WorkspaceRuntimeSettings.vue');
assert(!settings.includes('{{ recipe.kind }}'));
assert(!settings.includes('{{ pack.status }}'));
assert(settings.includes("formatAgentEnumLabel(t, 'workspaceKind', recipe.kind)"));
assert(settings.includes("formatAgentEnumLabel(t, 'packStatus', pack.status)"));

const runtime = read('packages/frontend/src/features/agent/runtime/WorkspaceRuntimePanel.vue');
assert(!runtime.includes('${workspace.profile.kind}'));
assert(!runtime.includes('{{ activeWorkspace.profile.kind }}'));
assert(runtime.includes("formatAgentEnumLabel(t, 'workspaceKind', workspace.profile.kind)"));
assert(runtime.includes("formatAgentEnumLabel(t, 'workspaceKind', activeWorkspace.profile.kind)"));

const messages = read('packages/frontend/src/features/agent/runtime/MessageExchangePanel.vue');
assert(!messages.includes('{{ message.kind }}'));
assert(!messages.includes('{{ message.status }}'));
assert(messages.includes("formatAgentEnumLabel(t, 'subagentMessageKind', message.kind)"));
assert(messages.includes("formatAgentEnumLabel(t, 'subagentMessageStatus', message.status)"));

process.stdout.write('agent enum labels regression: PASS\n');
