import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceRuntimeEngine } from '../../packages/agent-runner/src/controller/workspace-runtime-engine';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-workspace-writer-guard-'));
try {
  const engine = new WorkspaceRuntimeEngine(directory, null as never);
  const internal = engine as unknown as {
    workspaceWriters: Map<string, number>;
    workspaceMutations: Set<string>;
  };
  const key = 'workspace-1\u00001';

  internal.workspaceWriters.set(key, 1);
  assert.throws(
    () =>
      engine.writeWorkspaceFile('workspace-1', 1, {
        path: 'file.txt',
        content: 'replacement',
        expectedSha256: null,
      }),
    /WORKSPACE_WRITER_ACTIVE_CONFLICT/,
  );
  assert.throws(
    () =>
      engine.moveWorkspaceFile('workspace-1', 1, {
        path: 'file.txt',
        destinationPath: 'next.txt',
        expectedSha256: null,
      }),
    /WORKSPACE_WRITER_ACTIVE_CONFLICT/,
  );
  assert.throws(
    () =>
      engine.deleteWorkspaceFile('workspace-1', 1, {
        path: 'file.txt',
        recursive: false,
        expectedSha256: null,
      }),
    /WORKSPACE_WRITER_ACTIVE_CONFLICT/,
  );
  assert.throws(
    () =>
      engine.applyWorkspacePatch('workspace-1', 1, {
        patch: '--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+new\n',
        expectedFiles: [],
      }),
    /WORKSPACE_WRITER_ACTIVE_CONFLICT/,
  );

  internal.workspaceWriters.delete(key);
  internal.workspaceMutations.add(key);
  assert.throws(
    () => engine.acquireWorkspaceWriter('workspace-1', 1),
    /WORKSPACE_WRITER_ACTIVE_CONFLICT/,
    'new Terminal/ACP writer owners must not enter while a governed mutation lease is active',
  );

  process.stdout.write('workspace live-writer mutation guard regression: PASS\n');
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
