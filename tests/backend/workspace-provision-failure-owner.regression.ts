import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RunnerJournal, payloadHash } from '../../packages/agent-runner/src/controller/journal';
import { RunnerControllerServer } from '../../packages/agent-runner/src/controller/server';
import { CleanupPlanner } from '../../packages/agent-runner/src/controller/cleanup-planner';
import type { WorkspaceProvisionCommand, WorkspaceRecord } from '../../packages/agent-runner/src/types';

const provisionCommand = (workspaceId: string, commandId: string): WorkspaceProvisionCommand => ({
  commandId,
  workspaceId,
  generation: 1,
  deadlineAt: 10_000,
  action: 'provision',
  recipeId: 'shell',
  recipeRevision: '1',
  runtimeDigest: 'runtime',
  catalogRevision: 'catalog',
  toolchain: [],
  runnerPlugins: [],
  acpProfiles: [],
  browserTarget: null,
  retained: false,
});

const creatingWorkspace = (workspaceId: string): WorkspaceRecord => ({
  workspaceId,
  generation: 1,
  status: 'creating',
  retained: false,
  toolchain: [],
  runnerPlugins: [],
  acpProfiles: [],
  browserTarget: null,
});

const main = async (): Promise<void> => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-provision-failure-owner-'));
  try {
    const journal = new RunnerJournal(path.join(root, 'state', 'journal.json'));
    const partials = new Set<string>();
    const removed: string[] = [];
    const cleanedHomes: string[] = [];

    const runtimeEngine = {
      create: async (command: WorkspaceProvisionCommand) => {
        partials.add(command.workspaceId);
        if (command.workspaceId === 'workspace-create-failure') {
          throw new Error('SIMULATED_CREATE_FAILURE');
        }
      },
      remove: async (workspaceId: string) => {
        removed.push(workspaceId);
        partials.delete(workspaceId);
      },
    };
    const pluginRunner = {
      prepareWorkspace: (workspace: WorkspaceRecord) => {
        if (workspace.workspaceId === 'workspace-plugin-failure') {
          throw new Error('SIMULATED_PLUGIN_PREPARE_FAILURE');
        }
      },
      cleanupGeneration: (workspaceId: string) => {
        cleanedHomes.push(workspaceId);
      },
    };
    const server = new RunnerControllerServer({
      journal,
      installer: { ensure: async () => undefined },
      runtimeEngine,
      pluginRunner,
    } as never);
    const execute = (
      server as unknown as {
        executeWorkspaceCommand(command: WorkspaceProvisionCommand): Promise<void>;
      }
    ).executeWorkspaceCommand.bind(server);

    for (const [workspaceId, commandId] of [
      ['workspace-create-failure', 'command-create-failure'],
      ['workspace-plugin-failure', 'command-plugin-failure'],
    ] as const) {
      const command = provisionCommand(workspaceId, commandId);
      journal.begin(commandId, payloadHash(command), 'provision', workspaceId);
      journal.running(commandId);
      await execute(command);

      assert.equal(journal.command(commandId)?.status, 'failed');
      assert.equal(
        journal.workspace(workspaceId)?.status,
        'failed',
        'ordinary provision failure must close the Runner Workspace owner state without restart',
      );
      assert.equal(partials.has(workspaceId), false, 'partial generation runtime must be removed best-effort');
      assert(removed.includes(workspaceId));
      assert(cleanedHomes.includes(workspaceId));
    }

    const legacyId = 'workspace-legacy-creating';
    journal.saveWorkspace(creatingWorkspace(legacyId));
    journal.begin('command-legacy-failed', 'legacy-hash', 'provision', legacyId);
    journal.running('command-legacy-failed');
    journal.fail('command-legacy-failed', 'SIMULATED_PROVISION_FAILURE');

    const activeId = 'workspace-active-creating';
    journal.saveWorkspace(creatingWorkspace(activeId));
    journal.begin('command-active-provision', 'active-hash', 'provision', activeId);
    journal.running('command-active-provision');

    const cleanup = new CleanupPlanner(root, journal, runtimeEngine as never);
    const legacyCleanup = await cleanup.runtimeCleanup([legacyId, activeId]);
    assert(legacyCleanup.deleted.includes(legacyId), 'terminal-failed legacy creating owner must be reclaimable');
    assert(
      legacyCleanup.skipped.includes(activeId),
      'creating Workspace with an active provision owner must remain protected',
    );
    assert.equal(journal.workspace(legacyId), null);
    assert.equal(journal.workspace(activeId)?.status, 'creating');

    journal.fail('command-active-provision', 'SIMULATED_PROVISION_FAILURE');
    const activeAfterTerminal = await cleanup.runtimeCleanup([activeId]);
    assert.deepEqual(activeAfterTerminal.deleted, [activeId]);
    assert.equal(journal.workspace(activeId), null);

    process.stdout.write('Workspace provision failure owner regression: PASS\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
