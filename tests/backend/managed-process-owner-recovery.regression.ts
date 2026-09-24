import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MANAGED_PROCESS_DETACHED,
  initializeManagedProcessRegistry,
  registerManagedProcess,
} from '../../packages/agent-runner/src/managed-process';

const root = new URL('../../', import.meta.url);
const read = (relativePath: string): string => fs.readFileSync(new URL(relativePath, root), 'utf8');

const main = async (): Promise<void> => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-managed-process-registry-'));
  try {
    assert.equal(initializeManagedProcessRegistry(directory), 0);
    if (MANAGED_PROCESS_DETACHED && process.platform === 'linux') {
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        detached: true,
        stdio: 'ignore',
      });
      assert(child.pid);
      registerManagedProcess(child, 'job', 'regression-job');
      const registry = JSON.parse(
        fs.readFileSync(path.join(directory, 'state', 'managed-processes.json'), 'utf8'),
      ) as Array<{ pid: number; startTime: string }>;
      assert.equal(registry.length, 1);
      assert.equal(registry[0]?.pid, child.pid);
      assert.match(registry[0]?.startTime ?? '', /^\d+$/);

      const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
      assert.equal(initializeManagedProcessRegistry(directory), 1);
      await Promise.race([
        closed,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('stale process was not reaped')), 3000)),
      ]);
    }

    const job = read('packages/agent-runner/src/worker/job-runner.ts');
    const acp = read('packages/agent-runner/src/controller/acp-process-runtime.ts');
    const plugin = read('packages/agent-runner/src/controller/plugin-runner-runtime.ts');
    const index = read('packages/agent-runner/src/index.ts');
    assert(job.includes("registerManagedProcess(child, 'job'"));
    assert(acp.includes("registerManagedProcess(child, 'acp'"));
    assert(plugin.includes("registerManagedProcess(child, 'plugin'"));
    assert(index.includes('initializeManagedProcessRegistry(root)'));
    assert(index.includes("process.once('SIGTERM'"));
    assert(index.includes('await terminateAllManagedProcesses()'));

    process.stdout.write('managed process owner recovery regression: PASS\n');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
