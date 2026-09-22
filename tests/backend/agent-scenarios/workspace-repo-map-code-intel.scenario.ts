import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceCodeIntelligence } from '../../../packages/agent-runner/src/controller/workspace-code-intelligence';
import { RunnerJournal } from '../../../packages/agent-runner/src/controller/journal';
import { RunnerControllerServer } from '../../../packages/agent-runner/src/controller/server';
import { registerWorkspaceToolContributions } from '../../../packages/backend/src/bootstrap/agent/tool-contributions';
import { RunnerHttpAdapter } from '../../../packages/backend/src/infrastructure/agent/workspace-runtime/runner-http.adapter';
import { ToolCatalog } from '../../../packages/backend/src/modules/agent/capabilities/tool-catalog';
import { modelFacingToolSchemas } from '../../../packages/backend/src/modules/agent/capabilities/tool-model-surface';
import { PolicyService } from '../../../packages/backend/src/modules/agent/capabilities/policy.service';
import { AgentTargetResolver } from '../../../packages/backend/src/modules/agent/capabilities/target-resolver';
import type { ToolContext } from '../../../packages/backend/src/modules/agent/capabilities/tool.types';
import {
  createWorkspaceCodeIntelTool,
  createWorkspaceRepoMapTool,
} from '../../../packages/backend/src/modules/agent/tools/host/workspace-coding-tools';
import type { AgentWorkspaceRepositoryPort } from '../../../packages/backend/src/modules/agent/workspace-runtime/workspace-runtime.repository.port';
import type { WorkspaceRuntimeService } from '../../../packages/backend/src/modules/agent/workspace-runtime/workspace-runtime.service';
import { scope } from './scenario-fixtures';

export const workspaceRepoMapCodeIntelScenario = async () => {
  const catalog = new ToolCatalog();
  registerWorkspaceToolContributions({
    catalog,
    repository: null!,
    targets: null!,
    runtime: null!,
    gateway: null!,
    cryptoHash: {
      sha256Utf8: (value: string) => createHash('sha256').update(value, 'utf8').digest('hex'),
    },
  });
  const descriptors = new Map(catalog.list(scope).map((descriptor) => [descriptor.name, descriptor]));
  assert.equal(
    descriptors.get('workspace_repo_map')?.riskClass,
    'read',
    'P-067 must expose one bounded read-only Repo Map navigation Tool',
  );
  assert.equal(
    descriptors.get('workspace_code_intel')?.riskClass,
    'read',
    'P-067 must expose one bounded read-only semantic code-intel Tool',
  );
  const planNames = new Set(
    modelFacingToolSchemas(
      catalog,
      scope,
      {
        environment: {
          kind: 'code',
          recipeId: 'scenario-code',
          recipeRevision: '1',
          runtimeDigest: 'scenario-runtime',
          catalogRevision: 'scenario-catalog',
          toolchain: [],
          runnerPlugins: [],
          acpProfiles: [],
          browserTarget: null,
        },
      },
      'plan',
    ).map((tool) => tool.name),
  );
  assert.equal(planNames.has('workspace_repo_map'), true);
  assert.equal(planNames.has('workspace_code_intel'), true);

  const navWorkspace = {
    ...scope,
    id: 'code-nav-workspace',
    runId: 'code-nav-run',
    agentRuntimeId: 'code-nav-runtime',
    retained: false,
    profile: {
      kind: 'code' as const,
      recipeId: 'scenario-code',
      recipeRevision: '1',
      runtimeDigest: 'scenario-runtime',
      catalogRevision: 'scenario-catalog',
      toolchain: [],
      runnerPlugins: [],
      acpProfiles: [],
      browserTarget: null,
    },
    generation: 7,
    status: 'running' as const,
    retainedManifestRef: null,
    version: 3,
    lastActiveAt: 1_800_000_000,
    createdAt: 1_800_000_000,
    updatedAt: 1_800_000_000,
  };
  const navRepository = {
    getWorkspace: async () => navWorkspace,
  } as unknown as AgentWorkspaceRepositoryPort;
  const navCrypto = {
    sha256Utf8: (value: string) => createHash('sha256').update(value, 'utf8').digest('hex'),
  };
  const navTargets = new AgentTargetResolver(navRepository, null!, navCrypto);
  const navContext: ToolContext = {
    ...scope,
    actor: {
      kind: 'agent',
      userId: scope.userId,
      appId: scope.appId,
      runId: navWorkspace.runId,
      agentRuntimeId: navWorkspace.agentRuntimeId,
    },
    runId: navWorkspace.runId,
    agentRuntimeId: navWorkspace.agentRuntimeId,
    connectionIds: [],
    environment: navWorkspace.profile,
    stepId: 'code-nav-step',
    signal: new AbortController().signal,
    deadlineAt: 1_800_500_000,
    maxOutputBytes: 64 * 1024,
    inputRevision: 4,
  };
  const repoMapInspection = await createWorkspaceRepoMapTool(
    navTargets,
    null! as WorkspaceRuntimeService,
    navCrypto,
  ).inspect({ target: 'workspace', id: navWorkspace.id, query: 'makeThing' }, navContext, 7);
  const codeIntelInspection = await createWorkspaceCodeIntelTool(
    navTargets,
    null! as WorkspaceRuntimeService,
    navCrypto,
  ).inspect(
    { target: 'workspace', id: navWorkspace.id, action: 'symbols', path: '/workspace/work/src/a.ts' },
    navContext,
    7,
  );
  for (const inspection of [repoMapInspection, codeIntelInspection]) {
    assert.equal(inspection.risk, 'read');
    assert.equal(inspection.target.kind, 'workspace');
    assert.equal(inspection.target.target, 'workspace');
    assert.equal(inspection.target.id, navWorkspace.id);
    assert.equal(inspection.mutation, false, 'Repo navigation projections must never become mutation authority');
    assert.ok(
      inspection.preconditions.some(
        (precondition) =>
          precondition.kind === 'workspaceGeneration' &&
          precondition.key === navWorkspace.id &&
          (precondition.observedValue as { generation?: number }).generation === navWorkspace.generation,
      ),
      'Repo navigation inspection must bind the current Workspace generation',
    );
    assert.equal(new PolicyService().decide(inspection, 7).action, 'allow');
  }

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-workspace-code-intel-'));
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
    'utf8',
  );
  const aPath = path.join(srcRoot, 'a.ts');
  const bPath = path.join(srcRoot, 'b.ts');
  const cPath = path.join(srcRoot, 'c.ts');
  const pyPath = path.join(srcRoot, 'fallback.py');
  const aSource = ["import { makeThing } from './b.js';", "export const result = makeThing('demo');", ''].join('\n');
  const bSource = [
    'export interface Thing { name: string }',
    'export function makeThing(name: string): Thing { return { name }; }',
    "export const broken: number = 'oops';",
    '',
  ].join('\n');
  const cSource = ["import { makeThing } from './b.js';", "export const second = makeThing('second');", ''].join('\n');
  fs.writeFileSync(aPath, aSource, 'utf8');
  fs.writeFileSync(bPath, bSource, 'utf8');
  fs.writeFileSync(cPath, cSource, 'utf8');
  fs.writeFileSync(
    path.join(srcRoot, 'bulk.ts'),
    Array.from(
      { length: 24 },
      (_, index) =>
        `export function navigationSymbol${index}(input: { id: number; label: string }): string { return input.label + input.id; }`,
    ).join('\n') + '\n',
    'utf8',
  );
  fs.writeFileSync(pyPath, 'def helper():\n    return 1\n', 'utf8');

  const intelligence = new WorkspaceCodeIntelligence();
  let revisionRebuilds = 0;
  let generationIsolationCases = 0;
  let fallbackCases = 0;
  let pathRejections = 0;
  try {
    const firstMap = await intelligence.repoMap('scenario-workspace\u00007', workRoot, {
      path: '/workspace/work',
      query: 'makeThing result',
      maxFiles: 8,
      maxSymbols: 32,
      maxOutputBytes: 8 * 1024,
    });
    assert.equal(firstMap.engine, 'typescript-native');
    assert.match(firstMap.revision, /^[a-f0-9]{64}$/);
    assert.equal(firstMap.cacheMisses, 1);
    assert.equal(firstMap.cacheHits, 0);
    assert.ok(firstMap.files.some((file) => file.path === '/workspace/work/src/a.ts'));
    const mappedB = firstMap.files.find((file) => file.path === '/workspace/work/src/b.ts');
    assert.ok(mappedB, 'Repo Map must include relevant imported source files');
    assert.equal(mappedB.sha256, createHash('sha256').update(bSource, 'utf8').digest('hex'));
    assert.ok(mappedB.symbols.some((symbol) => symbol.name === 'makeThing'));
    assert.ok(
      firstMap.files.some((file) => file.imports.some((item) => item.includes('./b.js'))),
      'Repo Map must expose AST-derived import relationships',
    );

    const cachedMap = await intelligence.repoMap('scenario-workspace\u00007', workRoot, {
      path: '/workspace/work',
      query: 'makeThing',
      maxFiles: 8,
      maxSymbols: 32,
      maxOutputBytes: 8 * 1024,
    });
    assert.equal(cachedMap.revision, firstMap.revision);
    assert.ok(cachedMap.cacheHits >= 1, 'unchanged file hashes must reuse the rebuildable index cache');

    const callColumn = aSource.split('\n')[1]!.indexOf('makeThing') + 1;
    const definition = await intelligence.codeIntel('scenario-workspace\u00007', workRoot, {
      action: 'definition',
      path: '/workspace/work/src/a.ts',
      line: 2,
      column: callColumn,
      maxResults: 20,
      maxOutputBytes: 16 * 1024,
    });
    assert.equal(definition.supported, true);
    assert.ok(
      definition.results.some((item) => 'path' in item && item.path === '/workspace/work/src/b.ts'),
      'TypeScript native definition must cross the import boundary',
    );

    const references = await intelligence.codeIntel('scenario-workspace\u00007', workRoot, {
      action: 'references',
      path: '/workspace/work/src/a.ts',
      line: 2,
      column: callColumn,
      maxResults: 20,
      maxOutputBytes: 16 * 1024,
    });
    assert.equal(references.supported, true);
    assert.ok(
      references.results.some((item) => 'path' in item && item.path === '/workspace/work/src/a.ts'),
      'TypeScript native references must include the importing caller',
    );
    assert.ok(
      references.results.some((item) => 'path' in item && item.path === '/workspace/work/src/c.ts'),
      'TypeScript native references must include a second importer in the same project',
    );

    const diagnostics = await intelligence.codeIntel('scenario-workspace\u00007', workRoot, {
      action: 'diagnostics',
      path: '/workspace/work/src/b.ts',
      maxResults: 20,
      maxOutputBytes: 16 * 1024,
    });
    assert.equal(diagnostics.supported, true);
    assert.ok(
      diagnostics.results.some((item) => 'code' in item && item.code === 2322),
      'TypeScript native diagnostics must surface semantic type errors',
    );

    const unsupported = await intelligence.codeIntel('scenario-workspace\u00007', workRoot, {
      action: 'symbols',
      path: '/workspace/work/src/fallback.py',
      maxResults: 20,
      maxOutputBytes: 8 * 1024,
    });
    assert.equal(unsupported.supported, false);
    assert.deepEqual(unsupported.fallback, {
      reason: 'LANGUAGE_UNSUPPORTED',
      searchTool: 'file_search',
      readTool: 'file_read',
    });
    fallbackCases += 1;

    const updatedB = bSource + 'export const extra = 1;\n';
    fs.writeFileSync(bPath, updatedB, 'utf8');
    const rebuiltMap = await intelligence.repoMap('scenario-workspace\u00007', workRoot, {
      path: '/workspace/work',
      query: 'extra makeThing',
      maxFiles: 8,
      maxSymbols: 32,
      maxOutputBytes: 8 * 1024,
    });
    assert.notEqual(rebuiltMap.revision, firstMap.revision, 'file hash changes must change the index revision');
    assert.ok(rebuiltMap.cacheMisses >= 2, 'file hash changes must trigger an incremental snapshot refresh');
    const rebuiltB = rebuiltMap.files.find((file) => file.path === '/workspace/work/src/b.ts');
    assert.equal(rebuiltB?.sha256, createHash('sha256').update(updatedB, 'utf8').digest('hex'));
    revisionRebuilds += 1;

    const nextGeneration = await intelligence.repoMap('scenario-workspace\u00008', workRoot, {
      path: '/workspace/work',
      query: 'makeThing',
      maxFiles: 8,
      maxSymbols: 32,
      maxOutputBytes: 8 * 1024,
    });
    assert.equal(nextGeneration.cacheHits, 0);
    assert.equal(nextGeneration.cacheMisses, 1, 'a new Workspace generation must not reuse the prior generation cache');
    generationIsolationCases += 1;

    const tinyMap = await intelligence.repoMap('scenario-workspace\u00007', workRoot, {
      path: '/workspace/work',
      maxFiles: 64,
      maxSymbols: 160,
      maxOutputBytes: 1024,
    });
    assert.ok(Buffer.byteLength(JSON.stringify(tinyMap.files), 'utf8') <= 1024);
    assert.equal(tinyMap.truncated, true, 'Repo Map output byte budget must truncate navigation projection');

    await assert.rejects(
      () =>
        intelligence.codeIntel('scenario-workspace\u00007', workRoot, {
          action: 'symbols',
          path: '/workspace/work/../outside.ts',
          maxResults: 10,
          maxOutputBytes: 4096,
        }),
      /WORKSPACE_PATH_FORBIDDEN/,
    );
    pathRejections += 1;

    const outside = path.join(directory, 'outside.ts');
    fs.writeFileSync(outside, 'export const outside = 1;\n', 'utf8');
    fs.symlinkSync(outside, path.join(srcRoot, 'linked.ts'));
    await assert.rejects(
      () =>
        intelligence.codeIntel('scenario-workspace\u00007', workRoot, {
          action: 'symbols',
          path: '/workspace/work/src/linked.ts',
          maxResults: 10,
          maxOutputBytes: 4096,
        }),
      /WORKSPACE_PATH_FORBIDDEN/,
    );
    pathRejections += 1;

    let httpCodecCases = 0;
    let generationConflictCases = 0;
    let httpValidationCases = 0;
    const journal = new RunnerJournal(path.join(directory, 'code-intel-journal.json'));
    journal.saveWorkspace({
      workspaceId: 'code-intel-workspace',
      generation: 7,
      status: 'running',
      retained: false,
      toolchain: [],
      runnerPlugins: [],
      acpProfiles: [],
      browserTarget: null,
    });
    const server = new RunnerControllerServer({
      token: 'code-intel-token',
      journal,
      runtimeEngine: {
        repoMap: (
          _workspaceId: string,
          generation: number,
          request: Parameters<WorkspaceCodeIntelligence['repoMap']>[2],
        ) => intelligence.repoMap('http-workspace\\u0000' + generation, workRoot, request),
        codeIntel: (
          _workspaceId: string,
          generation: number,
          request: Parameters<WorkspaceCodeIntelligence['codeIntel']>[2],
        ) => intelligence.codeIntel('http-workspace\\u0000' + generation, workRoot, request),
      },
      catalog: {},
      installer: {},
      storage: {},
      cleanup: {},
      pluginRunner: {},
      acpRuntime: { closeAll: () => undefined },
      terminalRuntime: { closeAll: () => undefined },
      browserTunnel: { closeAll: () => undefined },
    } as unknown as ConstructorParameters<typeof RunnerControllerServer>[0]).createServer();
    try {
      const baseUrl = await new Promise<string>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
          const address = server.address();
          if (!address || typeof address === 'string') {
            reject(new Error('SCENARIO_RUNNER_ADDRESS_INVALID'));
            return;
          }
          resolve('http://127.0.0.1:' + address.port);
        });
      });
      const adapter = new RunnerHttpAdapter(baseUrl, 'code-intel-token');
      const wireMap = await adapter.repoMap(
        'code-intel-workspace',
        7,
        {
          path: '/workspace/work',
          query: 'makeThing',
          maxFiles: 8,
          maxSymbols: 32,
          maxOutputBytes: 8 * 1024,
        },
        new AbortController().signal,
      );
      assert.equal(wireMap.engine, 'typescript-native');
      assert.ok(wireMap.files.some((file) => file.path === '/workspace/work/src/b.ts'));
      httpCodecCases += 1;

      const wireDefinition = await adapter.codeIntel(
        'code-intel-workspace',
        7,
        {
          action: 'definition',
          path: '/workspace/work/src/a.ts',
          line: 2,
          column: callColumn,
          maxResults: 20,
          maxOutputBytes: 16 * 1024,
        },
        new AbortController().signal,
      );
      assert.equal(wireDefinition.supported, true);
      assert.ok(wireDefinition.results.some((item) => 'path' in item && item.path === '/workspace/work/src/b.ts'));
      httpCodecCases += 1;

      const invalidResponse = await fetch(baseUrl + '/v1/workspaces/code-intel-workspace/coding/repo-map', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer code-intel-token',
          'Content-Type': 'application/json',
          'X-Nexus-Agent-Protocol': '2026-09-13',
        },
        body: JSON.stringify({
          generation: 7,
          path: '/workspace/work',
          maxFiles: 8,
          maxSymbols: 32,
          maxOutputBytes: 8192,
          unexpected: true,
        }),
      });
      assert.equal(invalidResponse.status, 400, 'Repo Map HTTP codec must reject unknown request fields');
      httpValidationCases += 1;

      await assert.rejects(
        () =>
          adapter.repoMap(
            'code-intel-workspace',
            6,
            {
              path: '/workspace/work',
              maxFiles: 8,
              maxSymbols: 32,
              maxOutputBytes: 8192,
            },
            new AbortController().signal,
          ),
        /WORKSPACE_GENERATION_CONFLICT/,
      );
      generationConflictCases += 1;
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }

    return [
      { name: 'workspace_repo_map_tools', value: 1, unit: 'tools' },
      { name: 'workspace_code_intel_tools', value: 1, unit: 'tools' },
      { name: 'workspace_code_navigation_plan_tools', value: 2, unit: 'tools' },
      { name: 'workspace_code_navigation_read_inspections', value: 2, unit: 'tools' },
      { name: 'workspace_code_navigation_generation_preconditions', value: 2, unit: 'preconditions' },
      { name: 'workspace_repo_map_indexed_files', value: firstMap.indexedFiles, unit: 'files' },
      { name: 'workspace_repo_map_cache_hits', value: cachedMap.cacheHits, unit: 'hits' },
      { name: 'workspace_repo_map_revision_rebuilds', value: revisionRebuilds, unit: 'cases' },
      { name: 'workspace_code_intel_definition_cases', value: 1, unit: 'cases' },
      { name: 'workspace_code_intel_reference_cases', value: 1, unit: 'cases' },
      { name: 'workspace_code_intel_diagnostic_cases', value: 1, unit: 'cases' },
      { name: 'workspace_code_intel_fallback_cases', value: fallbackCases, unit: 'cases' },
      { name: 'workspace_code_intel_generation_isolation', value: generationIsolationCases, unit: 'cases' },
      { name: 'workspace_code_intel_path_rejections', value: pathRejections, unit: 'cases' },
      { name: 'workspace_repo_map_bounded_outputs', value: tinyMap.truncated ? 1 : 0, unit: 'cases' },
      { name: 'workspace_code_intel_http_codec_cases', value: httpCodecCases, unit: 'cases' },
      { name: 'workspace_code_intel_http_validation_cases', value: httpValidationCases, unit: 'cases' },
      { name: 'workspace_code_intel_generation_conflicts', value: generationConflictCases, unit: 'cases' },
    ];
  } finally {
    intelligence.dispose();
    fs.rmSync(directory, { recursive: true, force: true });
  }
};
