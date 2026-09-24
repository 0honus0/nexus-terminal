import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceRuntimeEngine } from '../../packages/agent-runner/src/controller/workspace-runtime-engine';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-workspace-job-drain-'));
const engine = new WorkspaceRuntimeEngine(directory, null as never);
const internal = engine as unknown as {
  runtime: {
    prepareJob(request: unknown): { file: string; argv: string[]; cwd: string; env: NodeJS.ProcessEnv };
    stop(workspaceId: string, generation: number): void;
  };
  jobs: Map<string, Set<unknown>>;
};

let stopCommittedAt = 0;
internal.runtime.prepareJob = () => ({
  file: '/bin/sh',
  argv: ['-c', "trap '' TERM; echo ready; while :; do sleep 1; done"],
  cwd: directory,
  env: {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    LANG: process.env.LANG ?? 'C.UTF-8',
  },
});
internal.runtime.stop = () => {
  stopCommittedAt = Date.now();
};

const request = {
  jobId: 'job-drain-regression',
  workspaceId: 'workspace-drain',
  generation: 1,
  deadlineAt: Math.floor(Date.now() / 1000) + 30,
  argv: ['ignored'],
  cwd: '/workspace/work',
  maxBytes: 4096,
  timeoutMs: 10_000,
};

const main = async (): Promise<void> => {
  try {
    const jobOutcome = engine.executeJob(request).then(
      () => null,
      (error: unknown) => error,
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    const started = Date.now();
    const stop = engine.stop(request.workspaceId, request.generation);

    await assert.rejects(
      () =>
        engine.executeJob({
          ...request,
          jobId: 'job-drain-late',
        }),
      /WORKSPACE_JOB_ACTIVE_CONFLICT/,
      'new jobs must not enter while the lifecycle drain owns the generation',
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    assert.equal(
      internal.jobs.get('workspace-drain\u00001')?.size,
      1,
      'the live owner must remain registered until JobRunner observes process-group close',
    );

    await stop;
    const elapsed = Date.now() - started;
    const jobError = await jobOutcome;
    assert(jobError instanceof Error);
    assert.match(jobError.message, /WORKSPACE_JOB_CANCELLED/);
    assert(elapsed >= 1_800, `stop committed before the SIGTERM→SIGKILL drain window completed: ${elapsed}ms`);
    assert(stopCommittedAt - started >= 1_800, 'runtime.stop must execute only after the old job owner is gone');
    assert.equal(internal.jobs.has('workspace-drain\u00001'), false);

    process.stdout.write('workspace job lifecycle drain regression: PASS\n');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
