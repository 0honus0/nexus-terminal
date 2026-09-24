import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), 'utf8');

const acp = read('packages/frontend/src/features/agent/settings/AcpRuntimeSettings.vue');
assert(acp.includes('const removeIntegration = async (integration: AgentIntegrationViewDto): Promise<void> =>'));
assert(acp.includes('const configuration = acpConfiguration(integration);'));
assert(acp.includes('await feedback.confirm({'));
assert(acp.includes("t('agent.settings.acpRuntime.confirmDeleteIntegration'"));
assert(
  acp.indexOf('await feedback.confirm({') <
    acp.indexOf('agentApi.deleteIntegration(DEFAULT_AGENT_APP_ID, integration)'),
);

const workspace = read('packages/frontend/src/features/agent/runtime/WorkspaceRuntimePanel.vue');
assert(workspace.includes('const deleteWorkspace = async (workspace: AgentWorkspaceDto): Promise<void> =>'));
assert(workspace.includes("t('agent.workspaceRuntime.confirmDeleteWorkspace', { id: workspace.id })"));
assert(workspace.includes("workspaceAction(workspace, 'delete');"));
assert(workspace.includes('@click="deleteWorkspace(activeWorkspace)"'));
assert(!workspace.includes('@click="workspaceAction(activeWorkspace, \'delete\')"'));

process.stdout.write('destructive delete confirmation regression: PASS\n');
