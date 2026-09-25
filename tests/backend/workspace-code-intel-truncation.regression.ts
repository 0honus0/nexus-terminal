import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceCodeIntelligence } from '../../packages/agent-runner/src/controller/workspace-code-intelligence';

const main = async (): Promise<void> => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-code-intel-truncation-'));
  const workRoot = path.join(directory, 'work');
  const srcRoot = path.join(workRoot, 'src');
  fs.mkdirSync(srcRoot, { recursive: true });
  fs.writeFileSync(
    path.join(workRoot, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
      },
      include: ['src/**/*.ts'],
    }),
  );

  const early = [
    'export function alphaOne() { return 1; }',
    'export function alphaTwo() { return 2; }',
    'export function alphaThree() { return 3; }',
    '',
  ].join('\n');
  const target = [
    'export function needleTarget(value: number) { return value + 1; }',
    'export function secondNeedle() { return needleTarget(2); }',
    'export function thirdNeedle() { return needleTarget(3); }',
    '',
  ].join('\n');
  const caller = [
    "import { needleTarget } from './z-target.js';",
    'export const callerOne = needleTarget(10);',
    'export const callerTwo = needleTarget(20);',
    '',
  ].join('\n');

  fs.writeFileSync(path.join(srcRoot, 'a-early.ts'), early);
  fs.writeFileSync(path.join(srcRoot, 'z-target.ts'), target);
  fs.writeFileSync(path.join(srcRoot, 'zz-caller.ts'), caller);

  const intelligence = new WorkspaceCodeIntelligence();
  try {
    const map = await intelligence.repoMap('regression\u00001', workRoot, {
      path: '/workspace/work',
      query: 'needleTarget',
      maxFiles: 1,
      maxSymbols: 1,
      maxOutputBytes: 8 * 1024,
    });
    assert.equal(map.files.length, 1);
    assert.equal(
      map.files[0]?.path,
      '/workspace/work/src/z-target.ts',
      'relevance discovery must scan past earlier path-sorted files before selecting top-K',
    );
    assert.equal(map.truncated, true, 'file/symbol count limits must surface truncation');

    const symbols = await intelligence.codeIntel('regression\u00001', workRoot, {
      action: 'symbols',
      path: '/workspace/work/src/z-target.ts',
      maxResults: 1,
      maxOutputBytes: 8 * 1024,
    });
    assert.equal(symbols.results.length, 1);
    assert.equal(symbols.truncated, true, 'symbol count truncation must be explicit');

    const line = 1;
    const column = target.split('\n')[0]!.indexOf('needleTarget') + 1;
    const references = await intelligence.codeIntel('regression\u00001', workRoot, {
      action: 'references',
      path: '/workspace/work/src/z-target.ts',
      line,
      column,
      maxResults: 1,
      maxOutputBytes: 8 * 1024,
    });
    assert.equal(references.results.length, 1);
    assert.equal(references.truncated, true, 'reference count truncation must be explicit');

    process.stdout.write('Workspace code intelligence truncation regression: PASS\n');
  } finally {
    intelligence.dispose();
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
