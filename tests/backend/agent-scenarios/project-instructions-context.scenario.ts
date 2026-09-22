import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PROJECT_INSTRUCTION_LIMITS,
  resolveProjectInstructions,
} from '../../../packages/agent-runner/src/controller/project-instructions';
import { RunnerJournal } from '../../../packages/agent-runner/src/controller/journal';
import { RunnerControllerServer } from '../../../packages/agent-runner/src/controller/server';
import { RunnerHttpAdapter } from '../../../packages/backend/src/infrastructure/agent/workspace-runtime/runner-http.adapter';
import { ProviderService } from '../../../packages/backend/src/modules/agent/ai/provider.service';
import { ModelStepRunner } from '../../../packages/backend/src/modules/agent/runtime/execution/model-step-runner';
import { clock, scope } from './scenario-fixtures';
import { contextService } from './scenario-context-helpers';
import {
  AgentBenchmarkCase,
  benchmarkProvider,
  benchmarkSnapshot,
  ScenarioModelCallLimiter,
  ScriptedLanguageModel,
  StaticProviderRepository,
} from './scenario-benchmark-helpers';

export const projectInstructionsContextScenario = async () => {
  const service = contextService([]);
  const baseInput = {
    scope,
    threadId: 'scenario-thread',
    runId: 'scenario-run',
    currentInput: 'Update src/parser/index.ts and follow the repository rules.',
    modelContextWindow: 8_192,
    maxContextTokens: 8_000,
    reservedOutputTokens: 256,
    maxRecallItems: 5,
    maxRecallBytes: 8_192,
    tools: [],
  } as const;
  const withoutProject = await service.compose(baseInput);
  const withProject = await service.compose({
    ...baseInput,
    projectInstructions: [
      {
        path: '/workspace/work/AGENTS.md',
        scopePath: '/workspace/work',
        projectRoot: '/workspace/work',
        hash: 'a'.repeat(64),
        content: 'ROOT_RULE_MARKER: run tests before finishing.',
        sourceBytes: 44,
        contentBytes: 44,
        truncated: false,
        provenance: 'workspace',
      },
      {
        path: '/workspace/work/src/parser/AGENTS.md',
        scopePath: '/workspace/work/src/parser',
        projectRoot: '/workspace/work',
        hash: 'b'.repeat(64),
        content: 'NESTED_RULE_MARKER: generated parser files are immutable.',
        sourceBytes: 57,
        contentBytes: 57,
        truncated: false,
        provenance: 'workspace',
      },
    ],
  });

  const encoded = withProject.instructions.join('\n');
  assert.match(encoded, /ROOT_RULE_MARKER/, 'repo-root AGENTS.md must enter the stable model instruction prefix');
  assert.match(
    encoded,
    /NESTED_RULE_MARKER/,
    'matching nested AGENTS.md must enter the stable model instruction prefix after root rules',
  );
  assert.ok(
    encoded.indexOf('ROOT_RULE_MARKER') < encoded.indexOf('NESTED_RULE_MARKER'),
    'deeper project instructions must be ordered after broader root instructions',
  );
  assert.notEqual(
    withProject.stablePrefixHash,
    withoutProject.stablePrefixHash,
    'project instruction content must naturally participate in stablePrefixHash and P-081 cache lineage',
  );
  assert.ok(
    withProject.tokenDiagnostics.projectInstructionTokens > 0,
    'project instruction tokens must be first-class Context telemetry',
  );
  assert.equal(
    withProject.sourceRanges.filter((source) => source.kind === 'project_instruction').length,
    2,
    'project instruction provenance must be visible in Context source ranges',
  );

  const httpDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-project-instructions-http-'));
  let httpCodecCases = 0;
  let generationConflictCases = 0;
  let runnerServer: ReturnType<RunnerControllerServer['createServer']> | null = null;
  try {
    const journal = new RunnerJournal(path.join(httpDirectory, 'journal.json'));
    journal.saveWorkspace({
      workspaceId: 'scenario-workspace',
      generation: 7,
      status: 'running',
      retained: false,
      toolchain: [],
      runnerPlugins: [],
      acpProfiles: [],
      browserTarget: null,
    });
    runnerServer = new RunnerControllerServer({
      token: 'scenario-token',
      journal,
      runtimeEngine: {
        projectInstructions: (workspaceId: string, generation: number, targetDirectories: readonly string[]) => {
          assert.equal(workspaceId, 'scenario-workspace');
          assert.equal(generation, 7);
          return {
            targetDirectories: [...targetDirectories],
            instructions: [
              {
                path: '/workspace/work/AGENTS.md',
                scopePath: '/workspace/work',
                projectRoot: '/workspace/work',
                hash: 'c'.repeat(64),
                content: 'HTTP_CODEC_RULE',
                sourceBytes: 15,
                contentBytes: 15,
                truncated: false,
                provenance: 'workspace' as const,
              },
            ],
            omitted: [],
          };
        },
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
    const baseUrl = await new Promise<string>((resolve, reject) => {
      runnerServer!.once('error', reject);
      runnerServer!.listen(0, '127.0.0.1', () => {
        const address = runnerServer!.address();
        if (!address || typeof address === 'string') {
          reject(new Error('SCENARIO_RUNNER_ADDRESS_INVALID'));
          return;
        }
        resolve(`http://127.0.0.1:${address.port}`);
      });
    });
    const runnerAdapter = new RunnerHttpAdapter(baseUrl, 'scenario-token');
    const httpProjection = await runnerAdapter.projectInstructions('scenario-workspace', 7, [
      '/workspace/work/src/parser',
    ]);
    assert.deepEqual(httpProjection.targetDirectories, ['/workspace/work/src/parser']);
    assert.equal(httpProjection.instructions[0]?.content, 'HTTP_CODEC_RULE');
    httpCodecCases += 1;

    const invalidCodecResponse = await fetch(`${baseUrl}/v1/workspaces/scenario-workspace/project-instructions`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer scenario-token',
        'Content-Type': 'application/json',
        'X-Nexus-Agent-Protocol': '2026-09-13',
      },
      body: JSON.stringify({
        generation: 7,
        targetDirectories: ['/workspace/work'],
        unexpected: true,
      }),
    });
    assert.equal(invalidCodecResponse.status, 400, 'Runner project-instruction codec must reject unknown fields');
    httpCodecCases += 1;

    await assert.rejects(
      () => runnerAdapter.projectInstructions('scenario-workspace', 6, ['/workspace/work']),
      /WORKSPACE_GENERATION_CONFLICT/,
      'Runner generation conflicts must survive the Backend HTTP adapter as a stable error code',
    );
    generationConflictCases += 1;
  } finally {
    if (runnerServer) {
      await new Promise<void>((resolve, reject) => runnerServer!.close((error) => (error ? reject(error) : resolve())));
    }
    fs.rmSync(httpDirectory, { recursive: true, force: true });
  }

  const auditBenchmark: AgentBenchmarkCase = {
    id: 'project-instruction-audit',
    prompt: 'Inspect the working subtree.',
    toolName: 'scenario_noop',
    toolArgumentsJson: '{}',
    toolDescription: 'No-op scenario tool.',
    toolInputSchema: { type: 'object', additionalProperties: false },
    toolSummary: 'noop',
    finalText: 'done',
    usage: [
      { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
      { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
    ],
  };
  const auditSnapshot = benchmarkSnapshot(auditBenchmark, scope);
  auditSnapshot.definition = {
    ...auditSnapshot.definition,
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
  };
  auditSnapshot.recentEntries = [
    ...auditSnapshot.recentEntries,
    {
      id: 'project-instruction-audit-tool-calls',
      sequence: 2,
      kind: 'assistant_message',
      payload: {
        text: '',
        toolCalls: [
          {
            id: 'valid-cwd',
            name: 'shell_execute',
            argumentsJson: JSON.stringify({
              target: 'workspace',
              id: 'workspace-audit',
              command: { kind: 'argv', argv: ['pwd'] },
              cwd: '/workspace/work/src/parser',
            }),
          },
          {
            id: 'outside-cwd',
            name: 'shell_execute',
            argumentsJson: JSON.stringify({
              target: 'workspace',
              id: 'workspace-audit',
              command: { kind: 'argv', argv: ['pwd'] },
              cwd: '/workspace/work/../outside',
            }),
          },
          {
            id: 'read-target',
            name: 'file_read',
            argumentsJson: JSON.stringify({
              target: 'workspace',
              id: 'workspace-audit',
              path: '/workspace/work/packages/api/src/index.ts',
            }),
          },
          {
            id: 'search-target',
            name: 'file_search',
            argumentsJson: JSON.stringify({
              target: 'workspace',
              id: 'workspace-audit',
              path: '/workspace/work/packages/web',
            }),
          },
          {
            id: 'patch-target',
            name: 'file_patch',
            argumentsJson: JSON.stringify({
              target: 'workspace',
              id: 'workspace-audit',
              expectedFiles: [
                { path: 'packages/core/src/a.ts', sha256: 'a'.repeat(64) },
                { path: '/workspace/work/../../outside.ts', sha256: 'b'.repeat(64) },
              ],
            }),
          },
        ],
      },
      createdAt: auditSnapshot.createdAt + 1,
    },
  ];
  const auditModel = new ScriptedLanguageModel([]);
  const auditProviders = new ProviderService(new StaticProviderRepository(benchmarkProvider), auditModel, clock);
  let capturedTargets: string[] = [];
  const absentWorkspaceRunner = new ModelStepRunner(
    auditProviders,
    contextService([]),
    auditModel,
    new ScenarioModelCallLimiter(),
    {
      load: async (_scope, _runId, _runtimeId, targetDirectories) => {
        capturedTargets = [...targetDirectories];
        return null;
      },
    },
  );
  const absentWorkspacePrepared = await absentWorkspaceRunner.prepare(
    auditSnapshot,
    scope,
    [],
    {},
    undefined,
    undefined,
    'scenario-runtime-id',
  );
  assert.deepEqual(
    capturedTargets,
    [
      '/workspace/work',
      '/workspace/work/src/parser',
      '/workspace/work/packages/api/src',
      '/workspace/work/packages/web',
      '/workspace/work/packages/core/src',
    ],
    'project instruction target extraction must consume path-aware coding tools and reject normalized paths outside /workspace/work',
  );
  assert.equal(
    absentWorkspacePrepared.contextPlan.sourceRanges.some((source) => source.kind === 'project_instruction'),
    false,
    'a missing live workspace must remain fail-soft and must not synthesize project instructions',
  );

  const unavailableRunner = new ModelStepRunner(
    auditProviders,
    contextService([]),
    auditModel,
    new ScenarioModelCallLimiter(),
    {
      load: async () => {
        throw new Error('WORKSPACE_RUNTIME_UNAVAILABLE');
      },
    },
  );
  const unavailablePrepared = await unavailableRunner.prepare(
    auditSnapshot,
    scope,
    [],
    {},
    undefined,
    undefined,
    'scenario-runtime-id',
  );
  assert.equal(
    unavailablePrepared.contextPlan.sourceRanges.some((source) => source.kind === 'project_instruction'),
    false,
    'Runner unavailability must remain fail-soft and must not synthesize project instructions',
  );

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-project-instructions-'));
  const noRepoDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-project-instructions-no-repo-'));
  const worktreeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-project-instructions-worktree-'));
  const outsideDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-project-instructions-outside-'));
  let symlinkRejections = 0;
  let traversalRejections = 0;
  let unrelatedInstructionFiles = 0;
  let truncatedInstructionFiles = 0;
  let oversizedInstructionOmissions = 0;
  try {
    fs.mkdirSync(path.join(directory, '.git'));
    fs.mkdirSync(path.join(directory, 'src', 'parser'), { recursive: true });
    fs.mkdirSync(path.join(directory, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'AGENTS.md'), 'ROOT_FS_RULE: run parser tests.\n');
    fs.writeFileSync(
      path.join(directory, 'src', 'parser', 'AGENTS.md'),
      'NESTED_FS_RULE: do not edit generated parser output.\n',
    );
    fs.writeFileSync(path.join(directory, 'docs', 'AGENTS.md'), 'UNRELATED_FS_RULE: docs only.\n');
    const scoped = resolveProjectInstructions(directory, ['/workspace/work/src/parser']);
    assert.deepEqual(
      scoped.instructions.map((item) => item.path),
      ['/workspace/work/AGENTS.md', '/workspace/work/src/parser/AGENTS.md'],
      'Runner projection must load only root-to-target AGENTS.md files in broad-to-deep order',
    );
    assert.match(scoped.instructions[0]!.content, /ROOT_FS_RULE/);
    assert.match(scoped.instructions[1]!.content, /NESTED_FS_RULE/);
    unrelatedInstructionFiles = scoped.instructions.filter((item) => item.content.includes('UNRELATED_FS_RULE')).length;
    assert.equal(unrelatedInstructionFiles, 0, 'unrelated subtree AGENTS.md must not enter the projection');
    assert.equal(
      scoped.instructions.every((item) => /^[a-f0-9]{64}$/.test(item.hash)),
      true,
    );
    assert.equal(
      scoped.instructions.every((item) => item.projectRoot === '/workspace/work'),
      true,
    );

    fs.mkdirSync(path.join(noRepoDirectory, 'src'), { recursive: true });
    fs.writeFileSync(path.join(noRepoDirectory, 'AGENTS.md'), 'NO_REPO_ROOT_RULE\n');
    fs.writeFileSync(path.join(noRepoDirectory, 'src', 'AGENTS.md'), 'NO_REPO_NESTED_RULE\n');
    const noRepo = resolveProjectInstructions(noRepoDirectory, ['/workspace/work/src']);
    assert.deepEqual(
      noRepo.instructions.map((item) => item.projectRoot),
      ['/workspace/work', '/workspace/work'],
      'without a repo marker the current work root must be the only project root',
    );

    fs.mkdirSync(path.join(worktreeDirectory, 'packages', 'pkg', 'src'), { recursive: true });
    fs.writeFileSync(path.join(worktreeDirectory, 'AGENTS.md'), 'OUTER_ROOT_RULE\n');
    fs.writeFileSync(path.join(worktreeDirectory, 'packages', 'pkg', '.git'), 'gitdir: /safe/worktree-metadata\n');
    fs.writeFileSync(path.join(worktreeDirectory, 'packages', 'pkg', 'AGENTS.md'), 'WORKTREE_ROOT_RULE\n');
    const worktree = resolveProjectInstructions(worktreeDirectory, ['/workspace/work/packages/pkg/src']);
    assert.deepEqual(
      worktree.instructions.map((item) => item.path),
      ['/workspace/work/packages/pkg/AGENTS.md'],
      'a deeper .git worktree marker must reset project-root scope and exclude outer instructions',
    );
    assert.equal(worktree.instructions[0]!.projectRoot, '/workspace/work/packages/pkg');

    fs.writeFileSync(path.join(outsideDirectory, 'AGENTS.md'), 'OUTSIDE_RULE\n');
    fs.symlinkSync(outsideDirectory, path.join(directory, 'linked'), 'dir');
    assert.throws(
      () => resolveProjectInstructions(directory, ['/workspace/work/linked']),
      /WORKSPACE_PATH_FORBIDDEN/,
      'symlinked target directories must fail closed',
    );
    symlinkRejections += 1;
    assert.throws(
      () => resolveProjectInstructions(directory, ['/workspace/work/../../outside']),
      /WORKSPACE_PATH_FORBIDDEN/,
      'logical path traversal outside /workspace/work must fail closed',
    );
    traversalRejections += 1;

    const truncatedContent =
      'TRUNCATED_RULE_MARKER\n' + 'x'.repeat(PROJECT_INSTRUCTION_LIMITS.maxContentBytesPerFile + 512);
    fs.writeFileSync(path.join(noRepoDirectory, 'AGENTS.md'), truncatedContent);
    const truncatedProjection = resolveProjectInstructions(noRepoDirectory, ['/workspace/work']);
    assert.equal(truncatedProjection.instructions[0]!.truncated, true);
    assert.ok(
      truncatedProjection.instructions[0]!.contentBytes <= PROJECT_INSTRUCTION_LIMITS.maxContentBytesPerFile,
      'project instruction content must respect the per-file byte projection budget',
    );
    assert.equal(truncatedProjection.instructions[0]!.sourceBytes, Buffer.byteLength(truncatedContent, 'utf8'));
    truncatedInstructionFiles += 1;

    fs.writeFileSync(
      path.join(noRepoDirectory, 'AGENTS.md'),
      Buffer.alloc(PROJECT_INSTRUCTION_LIMITS.maxSourceFileBytes + 1, 0x61),
    );
    const oversizedProjection = resolveProjectInstructions(noRepoDirectory, ['/workspace/work']);
    assert.equal(oversizedProjection.instructions.length, 0);
    assert.deepEqual(
      oversizedProjection.omitted,
      [{ path: '/workspace/work/AGENTS.md', reason: 'source_too_large' }],
      'oversized instruction files must be omitted deterministically rather than partially trusted',
    );
    oversizedInstructionOmissions += 1;

    return [
      {
        name: 'project_instruction_tokens',
        value: withProject.tokenDiagnostics.projectInstructionTokens,
        unit: 'tokens',
      },
      {
        name: 'project_instruction_sources',
        value: withProject.sourceRanges.filter((source) => source.kind === 'project_instruction').length,
        unit: 'sources',
      },
      {
        name: 'stable_prefix_changed',
        value: withProject.stablePrefixHash !== withoutProject.stablePrefixHash ? 1 : 0,
        unit: 'cases',
      },
      { name: 'scoped_instruction_files', value: scoped.instructions.length, unit: 'files' },
      { name: 'unrelated_instruction_files', value: unrelatedInstructionFiles, unit: 'files' },
      { name: 'symlink_rejections', value: symlinkRejections, unit: 'cases' },
      { name: 'traversal_rejections', value: traversalRejections, unit: 'cases' },
      { name: 'truncated_instruction_files', value: truncatedInstructionFiles, unit: 'files' },
      { name: 'oversized_instruction_omissions', value: oversizedInstructionOmissions, unit: 'files' },
      { name: 'project_instruction_http_codec_cases', value: httpCodecCases, unit: 'cases' },
      { name: 'project_instruction_generation_conflicts', value: generationConflictCases, unit: 'cases' },
      { name: 'project_instruction_fail_soft_cases', value: 2, unit: 'cases' },
      { name: 'project_instruction_outside_cwd_rejections', value: 1, unit: 'cases' },
    ];
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(noRepoDirectory, { recursive: true, force: true });
    fs.rmSync(worktreeDirectory, { recursive: true, force: true });
    fs.rmSync(outsideDirectory, { recursive: true, force: true });
  }
};
