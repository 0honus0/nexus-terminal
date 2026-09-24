import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WorkspaceRuntimeService } from '../../packages/backend/src/modules/agent/workspace-runtime/workspace-runtime.service';
import type { AgentWorkspaceRepositoryPort } from '../../packages/backend/src/modules/agent/workspace-runtime/workspace-runtime.repository.port';
import type {
  AgentWorkspaceView,
  WorkspaceRuntimeCommandView,
} from '../../packages/backend/src/modules/agent/workspace-runtime/workspace-runtime.types';

const root = new URL('../../', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), 'utf8');

const serviceSource = read('packages/backend/src/modules/agent/workspace-runtime/workspace-runtime.service.ts');
assert(serviceSource.includes("transition: { kind: 'toolchainSwitch', previousStatus: workspace.status }"));
assert(serviceSource.includes('private toolchainSwitchPreviousStatus'));
assert(serviceSource.includes("command.status === 'unknown'"));
assert(serviceSource.includes("errorCode === 'WORKSPACE_RECONCILIATION_REQUIRED'"));

const repositorySource = read(
  'packages/backend/src/infrastructure/agent/workspace-runtime/sqlite-workspace.repository.ts',
);
assert(repositorySource.includes('request_json: string;'));
assert(repositorySource.includes('request: parseDurableJsonValue(row.request_json)'));
assert(repositorySource.includes('generation,status,request_json,result_json'));

const workspace = {
  id: 'workspace-switch',
  generation: 2,
  status: 'stopping',
  version: 9,
} as AgentWorkspaceView;

const statuses: string[] = [];
const repository = {
  getWorkspace: async () => workspace,
  setWorkspaceStatus: async (_scope, _workspaceId, _version, status) => {
    statuses.push(status);
    return { ...workspace, status };
  },
} as unknown as AgentWorkspaceRepositoryPort;

const service = new WorkspaceRuntimeService(null!, repository, null!, null!, null!, null!, null!, () => 100);
const sync = (
  service as unknown as {
    syncWorkspaceStatus(scope: { userId: number; appId: string }, command: WorkspaceRuntimeCommandView): Promise<void>;
  }
).syncWorkspaceStatus.bind(service);

const base = {
  userId: 1,
  appId: 'nexus.agent',
  id: 'command-switch-delete',
  workspaceId: workspace.id,
  action: 'delete',
  operationHash: 'hash',
  generation: workspace.generation,
  request: { workspaceId: workspace.id, transition: { kind: 'toolchainSwitch', previousStatus: 'running' } },
  result: null,
  deadlineAt: 100,
  createdAt: 90,
  completedAt: 99,
} satisfies Omit<WorkspaceRuntimeCommandView, 'status'>;

const main = async (): Promise<void> => {
  await sync({ userId: 1, appId: 'nexus.agent' }, { ...base, status: 'failed' });
  assert.equal(statuses.at(-1), 'running', 'delayed delete failure must restore frozen pre-switch status');

  await sync(
    { userId: 1, appId: 'nexus.agent' },
    {
      ...base,
      status: 'unknown',
      result: { errorCode: 'WORKSPACE_RECONCILIATION_REQUIRED' },
    },
  );
  assert.equal(
    statuses.at(-1),
    'failed',
    'unprovable delete outcome must leave stopping and surface reconciliation failure',
  );

  process.stdout.write('workspace toolchain switch reconcile regression: PASS\n');
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
