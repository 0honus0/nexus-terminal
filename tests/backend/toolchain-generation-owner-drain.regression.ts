import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceRuntimeEngine } from '../../packages/agent-runner/src/controller/workspace-runtime-engine';

const root = new URL('../../', import.meta.url);
const read = (relativePath: string): string => fs.readFileSync(new URL(relativePath, root), 'utf8');

const main = async (): Promise<void> => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-lifecycle-admission-gate-'));
  try {
    const engine = new WorkspaceRuntimeEngine(directory, null as never);
    const release = engine.beginWorkspaceLifecycleDrain('workspace-switch', 4);

    assert.throws(
      () => engine.acquireWorkspaceWriter('workspace-switch', 4),
      /WORKSPACE_WRITER_ACTIVE_CONFLICT/,
      'old-generation ACP/Terminal owners must not enter after delete drain starts',
    );
    await assert.rejects(
      () =>
        engine.executeJob({
          jobId: 'job-switch-late',
          workspaceId: 'workspace-switch',
          generation: 4,
          deadlineAt: Math.floor(Date.now() / 1000) + 30,
          argv: ['ignored'],
          cwd: '/workspace/work',
          maxBytes: 1024,
          timeoutMs: 1000,
        }),
      /WORKSPACE_JOB_ACTIVE_CONFLICT/,
      'old-generation jobs must not enter after delete drain starts',
    );
    release();

    const server = read('packages/agent-runner/src/controller/server.ts');
    const lifecycleStart = server.indexOf(
      'const releaseLifecycleDrain = this.dependencies.runtimeEngine.beginWorkspaceLifecycleDrain',
    );
    const closeOwners = server.indexOf('this.dependencies.acpRuntime.closeWorkspace', lifecycleStart);
    const removeRuntime = server.indexOf('await this.dependencies.runtimeEngine.remove', lifecycleStart);
    assert(lifecycleStart >= 0 && lifecycleStart < closeOwners && closeOwners < removeRuntime);
    assert(server.indexOf('releaseLifecycleDrain();', removeRuntime) > removeRuntime);

    const backend = read('packages/backend/src/modules/agent/workspace-runtime/workspace-runtime.service.ts');
    const switchStart = backend.indexOf('async switchToolVersions(');
    const deleteDispatch = backend.indexOf("'delete',", switchStart);
    const deleteSucceededGate = backend.indexOf("if (deleted.status !== 'succeeded')", deleteDispatch);
    const reconfigure = backend.indexOf('reconfigureWorkspace({', deleteSucceededGate);
    const provisionDispatch = backend.indexOf("'provision',", reconfigure);
    assert(switchStart >= 0);
    assert(
      deleteDispatch < deleteSucceededGate && deleteSucceededGate < reconfigure && reconfigure < provisionDispatch,
    );

    process.stdout.write('toolchain generation owner drain regression: PASS\n');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
