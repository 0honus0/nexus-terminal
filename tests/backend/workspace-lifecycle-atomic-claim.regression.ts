import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { WorkspaceRuntimeService } from '../../packages/backend/src/modules/agent/workspace-runtime/workspace-runtime.service';
import type { AgentWorkspaceRepositoryPort } from '../../packages/backend/src/modules/agent/workspace-runtime/workspace-runtime.repository.port';
import type {
  AgentWorkspaceView,
  WorkspaceRuntimeCommandView,
  WorkspaceStatus,
} from '../../packages/backend/src/modules/agent/workspace-runtime/workspace-runtime.types';

const scope = { userId: 1, appId: 'nexus.agent' };
let workspace: AgentWorkspaceView = {
  ...scope,
  id: 'workspace-lifecycle-claim',
  runId: 'run-1',
  agentRuntimeId: 'runtime-1',
  retained: false,
  profile: {} as never,
  generation: 3,
  status: 'running',
  retainedManifestRef: null,
  version: 7,
  lastActiveAt: 90,
  createdAt: 80,
  updatedAt: 90,
};

let initialReads = 0;
let releaseInitialReads!: () => void;
const initialReadGate = new Promise<void>((resolve) => {
  releaseInitialReads = resolve;
});
let setStatusCalls = 0;
let commandsCreated = 0;
const commands = new Map<string, WorkspaceRuntimeCommandView>();

const repository = {
  getWorkspace: async () => {
    const snapshot = structuredClone(workspace);
    if (initialReads < 2) {
      initialReads += 1;
      if (initialReads === 2) releaseInitialReads();
      await initialReadGate;
    }
    return snapshot;
  },
  setWorkspaceStatus: async (
    _scope: typeof scope,
    _workspaceId: string,
    expectedVersion: number,
    status: WorkspaceStatus,
    now: number,
  ) => {
    setStatusCalls += 1;
    if (workspace.version !== expectedVersion) throw new Error('STATE_CONFLICT');
    workspace = {
      ...workspace,
      status,
      version: workspace.version + 1,
      lastActiveAt: now,
      updatedAt: now,
    };
    return structuredClone(workspace);
  },
  createCommand: async (record: {
    scope: typeof scope;
    id: string;
    workspaceId?: string;
    action: string;
    operationHash: string;
    generation: number;
    request: WorkspaceRuntimeCommandView['request'];
    deadlineAt: number;
    createdAt: number;
  }) => {
    commandsCreated += 1;
    const command: WorkspaceRuntimeCommandView = {
      ...record.scope,
      id: record.id,
      workspaceId: record.workspaceId ?? null,
      action: record.action,
      operationHash: record.operationHash,
      generation: record.generation,
      status: 'pending',
      request: record.request,
      result: null,
      deadlineAt: record.deadlineAt,
      createdAt: record.createdAt,
      completedAt: null,
    };
    commands.set(command.id, command);
    return command;
  },
  completeCommand: async (
    _scope: typeof scope,
    commandId: string,
    status: WorkspaceRuntimeCommandView['status'],
    result: WorkspaceRuntimeCommandView['result'],
    now: number,
  ) => {
    const current = commands.get(commandId);
    assert(current);
    const completed = { ...current, status, result, completedAt: now };
    commands.set(commandId, completed);
    return completed;
  },
} as unknown as AgentWorkspaceRepositoryPort;

const controller = {
  submit: async (request: { commandId: string }) => ({
    commandId: request.commandId,
    status: 'succeeded' as const,
    result: null,
  }),
};

const cryptoHash = {
  sha256Utf8: (value: string) => createHash('sha256').update(value, 'utf8').digest('hex'),
};

const main = async (): Promise<void> => {
  const service = new WorkspaceRuntimeService(
    controller as never,
    repository,
    null!,
    null!,
    null!,
    null!,
    cryptoHash,
    () => 100,
  );

  const results = await Promise.allSettled([
    service.action(scope, workspace.id, 'stop', 7),
    service.action(scope, workspace.id, 'delete', 7),
  ]);
  const fulfilled = results.filter(
    (result): result is PromiseFulfilledResult<WorkspaceRuntimeCommandView> => result.status === 'fulfilled',
  );
  const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');

  assert.equal(fulfilled.length, 1, 'exactly one lifecycle action may claim one workspace version');
  assert.equal(rejected.length, 1, 'the competing action must fail before dispatch');
  assert.match(String(rejected[0]!.reason), /STATE_CONFLICT/);
  assert.equal(commandsCreated, 1, 'the losing action must not create a runtime command');
  assert.equal(workspace.version, 9, 'claim and terminal projection each advance the workspace epoch exactly once');
  assert(['stopped', 'deleted'].includes(workspace.status));

  const winner = fulfilled[0]!.value;
  const claim = (winner.request as { lifecycleClaim?: { version?: number; previousStatus?: string } }).lifecycleClaim;
  assert.deepEqual(claim, { version: 8, previousStatus: 'running' });

  const beforeReplayProjection = setStatusCalls;
  await (
    service as unknown as {
      syncWorkspaceStatus(scope: typeof scope, command: WorkspaceRuntimeCommandView): Promise<void>;
    }
  ).syncWorkspaceStatus(scope, winner);
  assert.equal(
    setStatusCalls,
    beforeReplayProjection,
    'a completed command must not project through a newer workspace epoch',
  );

  const server = readFileSync(new URL('../../packages/agent-runner/src/controller/server.ts', import.meta.url), 'utf8');
  const actionStart = server.indexOf('private async workspaceAction');
  const gate = server.indexOf(
    'const releaseLifecycleDrain = this.dependencies.runtimeEngine.beginWorkspaceLifecycleDrain',
    actionStart,
  );
  const startBranch = server.indexOf("if (command.action === 'start')", actionStart);
  assert(actionStart >= 0 && gate > actionStart && gate < startBranch);

  process.stdout.write('workspace lifecycle atomic claim regression: PASS\n');
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
