import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), 'utf8');

const checkpoint = read('packages/backend/src/modules/agent/runtime/recovery/checkpoint.service.ts');
assert(checkpoint.includes('const backgroundJobs = await this.liveBackgroundJobs(scope, run.id);'));
assert(!checkpoint.includes("kind === 'recovery' ? await this.liveBackgroundJobs(scope, run.id) : []"));

const engine = read('packages/agent-runner/src/controller/workspace-runtime-engine.ts');
assert(engine.includes('private readonly workspaceWriters = new Map<string, number>();'));
assert(engine.includes('private readonly checkpointCaptures = new Set<string>();'));
assert(engine.includes('acquireWorkspaceWriter(workspaceId: string, generation: number): () => void'));
assert(engine.includes("if (this.checkpointCaptures.has(key)) throw new Error('WORKSPACE_CHECKPOINT_NOT_SAFE');"));
assert(engine.includes('(this.workspaceWriters.get(key) ?? 0) > 0'));
assert(engine.includes('this.checkpointCaptures.add(key);'));
assert(engine.includes('this.checkpointCaptures.delete(key);'));
assert(
  engine.indexOf(
    "if (this.checkpointCaptures.has(key)) throw new Error('WORKSPACE_CHECKPOINT_NOT_SAFE');",
    engine.indexOf('async executeJob'),
  ) > engine.indexOf('async executeJob'),
);

const acp = read('packages/agent-runner/src/controller/acp-process-runtime.ts');
assert(acp.includes('const releaseWriter = this.runtime.acquireWorkspaceWriter(workspaceId, generation);'));
assert(acp.includes('this.attach(websocket, execution, workspaceId, generation, releaseWriter)'));
assert(acp.includes('releaseOwnership();'));

const terminal = read('packages/agent-runner/src/controller/workspace-terminal-runtime.ts');
assert(terminal.includes('const releaseWriter = this.runtime.acquireWorkspaceWriter(workspaceId, generation);'));
assert(terminal.includes('this.attach(websocket, execution, workspaceId, generation, columns, rows, releaseWriter)'));
assert(terminal.includes('releaseOwnership();'));

process.stdout.write('checkpoint owner gate regression: PASS\n');
