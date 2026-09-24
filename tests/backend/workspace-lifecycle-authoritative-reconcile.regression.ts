import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RunnerJournal } from '../../packages/agent-runner/src/controller/journal';
import { Reconciler } from '../../packages/agent-runner/src/controller/reconciler';
import type { WorkspaceRecord } from '../../packages/agent-runner/src/types';
import { WorkspaceRuntimeService } from '../../packages/backend/src/modules/agent/workspace-runtime/workspace-runtime.service';
import type { WorkspaceRuntimeCommandView } from '../../packages/backend/src/modules/agent/workspace-runtime/workspace-runtime.types';

const workspace = (workspaceId: string, status: WorkspaceRecord['status']): WorkspaceRecord => ({
  workspaceId,
  generation: 1,
  status,
  retained: false,
  toolchain: [],
  runnerPlugins: [],
  acpProfiles: [],
  browserTarget: null,
});

const main = async (): Promise<void> => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-workspace-lifecycle-reconcile-'));
  try {
    const journal = new RunnerJournal(path.join(root, 'journal.json'));
    journal.saveWorkspace(workspace('workspace-provision', 'ready'));
    journal.saveWorkspace(workspace('workspace-start-mismatch', 'stopped'));

    journal.begin('command-provision', 'hash-provision', 'provision', 'workspace-provision');
    journal.running('command-provision');
    journal.begin('command-start', 'hash-start', 'start', 'workspace-start-mismatch');
    journal.running('command-start');

    const reconciler = new Reconciler(
      journal,
      {
        reconcile: async (record: WorkspaceRecord) => record,
      } as never,
      {
        reconcileHomes: () => undefined,
        activateWorkspace: async () => undefined,
      } as never,
    );
    await reconciler.reconcile();

    assert.equal(
      journal.command('command-provision')?.status,
      'succeeded',
      'startup must complete an interrupted lifecycle command whose authoritative postcondition already holds',
    );
    assert.deepEqual(journal.command('command-provision')?.result, {
      reconciled: true,
      workspaceStatus: 'ready',
    });
    assert.equal(
      journal.command('command-start')?.status,
      'unknown',
      'startup must keep an interrupted lifecycle command unknown when the postcondition does not hold',
    );

    let localStatus = 'starting';
    const projected: string[] = [];
    const controller = {
      workspaceStatus: async (workspaceId: string, generation: number) => {
        assert.equal(workspaceId, 'workspace-backend');
        assert.equal(generation, 3);
        return { workspaceId, generation, status: 'running' as const };
      },
    };
    const repository = {
      getWorkspace: async () => ({
        id: 'workspace-backend',
        generation: 3,
        status: localStatus,
        version: 7,
      }),
      setWorkspaceStatus: async (_scope: unknown, _id: string, _version: number, status: string) => {
        localStatus = status;
        projected.push(status);
        return {
          id: 'workspace-backend',
          generation: 3,
          status,
          version: 8,
        };
      },
    };
    const service = new WorkspaceRuntimeService(
      controller as never,
      repository as never,
      null!,
      null!,
      null!,
      null!,
      null!,
      () => 123,
    );
    const sync = (
      service as unknown as {
        syncWorkspaceStatus(
          scope: { userId: number; appId: string },
          command: WorkspaceRuntimeCommandView,
        ): Promise<void>;
      }
    ).syncWorkspaceStatus.bind(service);

    await sync(
      { userId: 1, appId: 'nexus.agent' },
      {
        userId: 1,
        appId: 'nexus.agent',
        id: 'command-backend',
        workspaceId: 'workspace-backend',
        action: 'start',
        operationHash: 'hash',
        generation: 3,
        status: 'unknown',
        request: { workspaceId: 'workspace-backend' },
        result: null,
        deadlineAt: 120,
        createdAt: 100,
        completedAt: 121,
      },
    );
    assert.deepEqual(
      projected,
      ['running'],
      'Backend unknown lifecycle projection must follow Runner authoritative status',
    );

    const serverSource = fs.readFileSync(
      new URL('../../packages/agent-runner/src/controller/server.ts', import.meta.url),
      'utf8',
    );
    assert(serverSource.includes('/^\\/v1\\/workspaces\\/([^/]+)\\/status$/'));
    assert(serverSource.includes('workspace.generation !== generation'));

    process.stdout.write('workspace lifecycle authoritative reconcile regression: PASS\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
