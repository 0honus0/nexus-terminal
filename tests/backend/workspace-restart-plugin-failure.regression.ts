import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RunnerJournal } from '../../packages/agent-runner/src/controller/journal';
import { RunnerControllerServer } from '../../packages/agent-runner/src/controller/server';
import { WorkspaceRuntimeService } from '../../packages/backend/src/modules/agent/workspace-runtime/workspace-runtime.service';
import type { AgentWorkspaceRepositoryPort } from '../../packages/backend/src/modules/agent/workspace-runtime/workspace-runtime.repository.port';
import type { AgentWorkspaceView } from '../../packages/backend/src/modules/agent/workspace-runtime/workspace-runtime.types';

const main = async (): Promise<void> => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-workspace-restart-plugin-failure-'));

  try {
    const journal = new RunnerJournal(path.join(directory, 'journal.json'));
    journal.saveWorkspace({
      workspaceId: 'restart-workspace',
      generation: 3,
      status: 'running',
      retained: false,
      toolchain: [],
      runnerPlugins: [],
      acpProfiles: [],
      browserTarget: null,
    });

    let restartCalls = 0;
    let stopCalls = 0;
    let disposeCalls = 0;
    let activateCalls = 0;
    const runner = new RunnerControllerServer({
      token: 'restart-token',
      journal,
      runtimeEngine: {
        restart: async () => {
          restartCalls += 1;
        },
        stop: async () => {
          stopCalls += 1;
        },
      },
      pluginRunner: {
        disposeWorkspace: async () => {
          disposeCalls += 1;
        },
        activateWorkspace: async () => {
          activateCalls += 1;
          throw new Error('PLUGIN_ACTIVATE_FAILED');
        },
      },
      acpRuntime: { closeWorkspace: () => undefined },
      terminalRuntime: { closeWorkspace: () => undefined },
      browserTunnel: { closeWorkspace: () => undefined },
      catalog: {},
      installer: {},
      storage: {},
      cleanup: {},
    } as unknown as ConstructorParameters<typeof RunnerControllerServer>[0]);

    const restartWorkspace = (
      runner as unknown as {
        workspaceAction(command: { action: 'restart'; workspaceId: string; generation: number }): Promise<void>;
      }
    ).workspaceAction.bind(runner);

    await assert.rejects(
      () => restartWorkspace({ action: 'restart', workspaceId: 'restart-workspace', generation: 3 }),
      /PLUGIN_ACTIVATE_FAILED/,
    );
    assert.equal(restartCalls, 1);
    assert.equal(activateCalls, 1);
    assert.equal(disposeCalls, 2, 'restart failure must dispose both the prior and any partially reactivated plugins');
    assert.equal(stopCalls, 1, 'restart failure must best-effort stop the restarted runtime');
    assert.equal(journal.workspace('restart-workspace')?.status, 'failed');

    const backendWorkspace = {
      id: 'restart-workspace',
      generation: 3,
      status: 'running',
      version: 7,
    } as AgentWorkspaceView;
    let projectedStatus = '';
    const repository = {
      getWorkspace: async () => backendWorkspace,
      setWorkspaceStatus: async (_scope, _workspaceId, _expectedVersion, status) => {
        projectedStatus = status;
        return { ...backendWorkspace, status };
      },
    } as unknown as AgentWorkspaceRepositoryPort;
    const service = new WorkspaceRuntimeService(null!, repository, null!, null!, null!, null!, null!, () => 123);
    const syncWorkspaceStatus = (
      service as unknown as {
        syncWorkspaceStatus(
          scope: { userId: number; appId: string },
          command: { workspaceId: string; generation: number; status: 'failed'; action: 'restart' },
        ): Promise<void>;
      }
    ).syncWorkspaceStatus.bind(service);

    await syncWorkspaceStatus(
      { userId: 1, appId: 'nexus.agent' },
      { workspaceId: 'restart-workspace', generation: 3, status: 'failed', action: 'restart' },
    );
    assert.equal(projectedStatus, 'failed');

    process.stdout.write('workspace restart plugin failure regression: PASS\n');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
