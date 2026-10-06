import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { WorkspaceCodeIntelligence } from '@nexus-terminal/code-intelligence';

export const codeIntelligenceSnapshotScenario = async () => {
  const files = {
    '/workspace/work/a.ts': 'export const value = 42;\n',
    '/workspace/work/b.ts': 'import { value } from "./a";\nconsole.log(value);\n',
    '/workspace/work/unrelated.ts': 'export const value = "not the referenced symbol";\n',
  };
  const engine = new WorkspaceCodeIntelligence({ files, truncated: false });
  try {
    const request = { path: '/workspace/work/b.ts', line: 2, column: 13, maxResults: 10, maxOutputBytes: 4096 };
    const definition = await engine.codeIntel('snapshot', '/workspace/work', { ...request, action: 'definition' });
    assert.equal(definition.engine, 'typescript-native');
    assert.equal(definition.supported, true);
    assert.equal(
      definition.sha256,
      createHash('sha256')
        .update(files[request.path as keyof typeof files])
        .digest('hex'),
    );
    assert.deepEqual(
      definition.results.map((result) => result.path),
      ['/workspace/work/a.ts'],
    );
    const references = await engine.codeIntel('snapshot', '/workspace/work', { ...request, action: 'references' });
    assert.ok(references.results.length >= 2);
    assert.ok(references.results.every((result) => result.path !== '/workspace/work/unrelated.ts'));
    const map = await engine.repoMap('snapshot', '/workspace/work', {
      path: '/workspace/work',
      maxFiles: 10,
      maxSymbols: 20,
      maxOutputBytes: 8192,
    });
    assert.equal(map.indexedFiles, 3);
    assert.equal(map.truncated, false);
    await assert.rejects(
      () =>
        engine.codeIntel('snapshot', '/workspace/work', {
          ...request,
          path: '/workspace/work/not-in-snapshot.ts',
          action: 'symbols',
        }),
      /WORKSPACE_NOT_FOUND/,
    );
    await assert.rejects(
      () => engine.codeIntel('snapshot', '/workspace/work', { ...request, path: '/etc/passwd', action: 'symbols' }),
      /WORKSPACE_PATH_FORBIDDEN/,
    );
  } finally {
    engine.dispose();
  }
  const bounded = new WorkspaceCodeIntelligence({ files, truncated: true });
  try {
    const result = await bounded.codeIntel('bounded', '/workspace/work', {
      action: 'symbols',
      path: '/workspace/work/a.ts',
      maxResults: 10,
      maxOutputBytes: 4096,
    });
    assert.equal(result.truncated, true);
  } finally {
    bounded.dispose();
  }
  return [{ name: 'semantic_snapshot_files', value: 3, unit: 'files' }];
};
