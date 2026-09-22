import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applyWorkspacePatch,
  readWorkspaceFile,
  searchWorkspace,
  statWorkspacePath,
} from '../../../packages/agent-runner/src/controller/workspace-coding-files';
import { RunnerJournal } from '../../../packages/agent-runner/src/controller/journal';
import { RunnerControllerServer } from '../../../packages/agent-runner/src/controller/server';
import {
  registerFileToolContributions,
  registerShellToolContributions,
  registerWorkspaceToolContributions,
} from '../../../packages/backend/src/bootstrap/agent/tool-contributions';
import { RunnerHttpAdapter } from '../../../packages/backend/src/infrastructure/agent/workspace-runtime/runner-http.adapter';
import { FileCapabilityService } from '../../../packages/backend/src/modules/agent/capabilities/file-capability.service';
import { ToolCatalog } from '../../../packages/backend/src/modules/agent/capabilities/tool-catalog';
import { modelFacingToolSchemas } from '../../../packages/backend/src/modules/agent/capabilities/tool-model-surface';
import { PolicyService } from '../../../packages/backend/src/modules/agent/capabilities/policy.service';
import { AgentTargetResolver } from '../../../packages/backend/src/modules/agent/capabilities/target-resolver';
import type { ToolContext } from '../../../packages/backend/src/modules/agent/capabilities/tool.types';
import { createUnifiedFileTools } from '../../../packages/backend/src/modules/agent/tools/host/file-tools';
import type { AgentWorkspaceRepositoryPort } from '../../../packages/backend/src/modules/agent/workspace-runtime/workspace-runtime.repository.port';
import type { WorkspaceFileTargetPort } from '../../../packages/backend/src/modules/agent/workspace-runtime/workspace-file-target.port';
import { scope } from './scenario-fixtures';

export const workspaceCodingToolSurfaceScenario = async () => {
  const catalog = new ToolCatalog();
  const codingCryptoHash = {
    sha256Utf8: (value: string) => createHash('sha256').update(value, 'utf8').digest('hex'),
  };
  registerFileToolContributions({
    catalog,
    files: null!,
    cryptoHash: codingCryptoHash,
  });
  registerShellToolContributions({ catalog, shell: null!, cryptoHash: codingCryptoHash });
  registerWorkspaceToolContributions({
    catalog,
    repository: null!,
    targets: null!,
    runtime: null!,
    cryptoHash: codingCryptoHash,
  });
  const descriptors = new Map(catalog.list(scope).map((descriptor) => [descriptor.name, descriptor]));
  assert.equal(descriptors.get('file_read')?.riskClass, 'read', 'canonical file read must remain read-only');
  assert.equal(descriptors.get('file_search')?.riskClass, 'read', 'canonical file search must remain read-only');
  assert.equal(
    descriptors.get('file_patch')?.riskClass,
    'mutate',
    'canonical file patch must remain governed mutation',
  );
  assert.equal(descriptors.get('workspace_repo_map')?.capability, 'file.read');
  assert.equal(descriptors.get('workspace_code_intel')?.capability, 'file.read');
  assert.equal(descriptors.get('shell_execute')?.riskClass, 'mutate', 'canonical execution must remain governed');
  assert.equal(descriptors.get('shell_execute')?.capability, 'shell.execute');
  assert.equal(descriptors.get('shell_job')?.riskClass, 'control');
  assert.equal(descriptors.get('shell_job')?.capability, 'shell.execute');
  const planToolNames = new Set(
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
  assert.equal(planToolNames.has('file_read'), true);
  assert.equal(planToolNames.has('file_search'), true);
  assert.equal(planToolNames.has('file_patch'), false);
  assert.equal(planToolNames.has('workspace_repo_map'), true);
  assert.equal(planToolNames.has('workspace_code_intel'), true);
  assert.equal(planToolNames.has('shell_execute'), false);
  assert.equal(planToolNames.has('shell_job'), true);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-workspace-coding-'));
  const workRoot = path.join(directory, 'work');
  const sourcePath = path.join(workRoot, 'src', 'example.ts');
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  const original = 'alpha\nneedle here\nomega\nneedle again\n';
  fs.writeFileSync(sourcePath, original, 'utf8');
  let traversalRejections = 0;
  let symlinkRejections = 0;
  let staleHashRejections = 0;
  let strictLocationRejections = 0;
  let fallbackSearches = 0;
  let httpCodecCases = 0;
  let generationConflictCases = 0;
  try {
    const read = readWorkspaceFile(workRoot, {
      path: '/workspace/work/src/example.ts',
      startLine: 2,
      endLine: 3,
      maxBytes: 1024,
    });
    assert.equal(read.content, 'needle here\nomega');
    assert.equal(read.sha256, createHash('sha256').update(original, 'utf8').digest('hex'));
    assert.equal(read.sizeBytes, Buffer.byteLength(original, 'utf8'));
    assert.equal(read.startLine, 2);
    assert.equal(read.endLine, 3);

    assert.throws(
      () => readWorkspaceFile(workRoot, { path: '/workspace/work/../outside.txt' }),
      /WORKSPACE_PATH_FORBIDDEN/,
    );
    traversalRejections += 1;

    const outside = path.join(directory, 'outside.txt');
    fs.writeFileSync(outside, 'outside\n', 'utf8');
    const symlink = path.join(workRoot, 'src', 'linked.txt');
    fs.symlinkSync(outside, symlink);
    assert.throws(
      () => readWorkspaceFile(workRoot, { path: '/workspace/work/src/linked.txt' }),
      /WORKSPACE_PATH_FORBIDDEN/,
    );
    symlinkRejections += 1;

    const originalPath = process.env.PATH;
    let search;
    try {
      process.env.PATH = '';
      search = searchWorkspace(workRoot, {
        query: 'needle',
        path: '/workspace/work/src',
        maxResults: 1,
        contextLines: 1,
        maxOutputBytes: 8 * 1024,
      });
    } finally {
      process.env.PATH = originalPath;
    }
    assert.equal(search.engine, 'fallback', 'search must have a bounded no-rg fallback');
    assert.equal(search.matches.length, 1);
    assert.equal(search.matches[0]?.path, '/workspace/work/src/example.ts');
    assert.equal(search.matches[0]?.line, 2);
    assert.equal(search.truncated, true, 'maxResults must bound search output');
    fallbackSearches += 1;

    const beforeHash = read.sha256;
    const patchText = [
      '--- a/src/example.ts',
      '+++ b/src/example.ts',
      '@@ -1,4 +1,4 @@',
      ' alpha',
      '-needle here',
      '+needle fixed',
      ' omega',
      ' needle again',
      '',
    ].join('\n');
    const dryRun = applyWorkspacePatch(workRoot, {
      patch: patchText,
      expectedFiles: [{ path: '/workspace/work/src/example.ts', sha256: beforeHash }],
      dryRun: true,
    });
    assert.equal(dryRun.applied, false);
    assert.equal(fs.readFileSync(sourcePath, 'utf8'), original, 'dry-run must never mutate the Workspace');
    assert.equal(dryRun.changes.length, 1);
    assert.equal(dryRun.changes[0]?.beforeSha256, beforeHash);

    const codingRepository = {
      getWorkspace: async () => ({
        ...scope,
        id: 'workspace-coding',
        runId: 'workspace-coding-run',
        agentRuntimeId: 'workspace-coding-runtime',
        retained: false,
        profile: {
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
        generation: 4,
        status: 'running',
        retainedManifestRef: null,
        version: 2,
        lastActiveAt: 1_800_000_000,
        createdAt: 1_800_000_000,
        updatedAt: 1_800_000_000,
      }),
    } as unknown as AgentWorkspaceRepositoryPort;
    const codingTargets = new AgentTargetResolver(codingRepository, null!, codingCryptoHash);
    const codingFileTarget = {
      stat: async (_context: ToolContext, _workspaceId: string, _generation: number, requestedPath: string) =>
        statWorkspacePath(workRoot, requestedPath),
      read: async (
        _context: ToolContext,
        _workspaceId: string,
        _generation: number,
        request: Parameters<typeof readWorkspaceFile>[1],
      ) => readWorkspaceFile(workRoot, request),
      applyPatch: async () => ({ changes: dryRun.changes, applied: true }),
    } as unknown as WorkspaceFileTargetPort;
    const codingFiles = new FileCapabilityService(codingTargets, codingFileTarget, null!);
    const inspectTool = createUnifiedFileTools(codingFiles, codingCryptoHash).find(
      (tool) => tool.descriptor.name === 'file_patch',
    );
    assert.ok(inspectTool, 'canonical file_patch Tool must exist');
    const inspectContext: ToolContext = {
      ...scope,
      actor: {
        kind: 'agent',
        userId: scope.userId,
        appId: scope.appId,
        runId: 'workspace-coding-run',
        agentRuntimeId: 'workspace-coding-runtime',
      },
      runId: 'workspace-coding-run',
      agentRuntimeId: 'workspace-coding-runtime',
      connectionIds: [],
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
      stepId: 'workspace-coding-step',
      signal: new AbortController().signal,
      deadlineAt: 1_800_500_000,
      maxOutputBytes: 64 * 1024,
      inputRevision: 3,
    };
    const patchInspection = await inspectTool.inspect(
      {
        target: 'workspace',
        id: 'workspace-coding',
        patch: patchText,
        expectedFiles: [{ path: '/workspace/work/src/example.ts', sha256: beforeHash }],
      },
      inspectContext,
      7,
    );
    assert.equal(patchInspection.risk, 'mutate');
    assert.equal(patchInspection.mutation, true);
    assert.equal(patchInspection.target.kind, 'workspace');
    assert.equal(patchInspection.target.target, 'workspace');
    assert.equal(patchInspection.target.id, 'workspace-coding');
    assert.ok(
      patchInspection.preconditions.some(
        (precondition) =>
          precondition.kind === 'fileHash' &&
          precondition.key === '/workspace/work/src/example.ts' &&
          precondition.observedValue === beforeHash,
      ),
      'patch inspection must bind the source SHA-256 into the governed mutation preconditions',
    );
    assert.equal(
      new PolicyService().decide(patchInspection, 7).action,
      'requireApproval',
      'file_patch must remain on the existing mutation approval path',
    );
    const toolPatchResult = await inspectTool.execute(patchInspection, inspectContext);
    assert.equal(toolPatchResult.ok, true);
    assert.equal(toolPatchResult.artifactRefs.length, 0);
    assert.match(toolPatchResult.verification.summary, /source hash|patched file/i);

    const applied = applyWorkspacePatch(workRoot, {
      patch: patchText,
      expectedFiles: [{ path: '/workspace/work/src/example.ts', sha256: beforeHash }],
    });
    assert.equal(applied.applied, true);
    assert.equal(applied.changes.length, 1);
    assert.notEqual(applied.changes[0]?.afterSha256, beforeHash);
    assert.equal(fs.readFileSync(sourcePath, 'utf8'), 'alpha\nneedle fixed\nomega\nneedle again\n');

    assert.throws(
      () =>
        applyWorkspacePatch(workRoot, {
          patch: patchText
            .replace('needle here', 'needle fixed')
            .replace('needle fixed\n+needle fixed', 'needle fixed\n+needle newer'),
          expectedFiles: [{ path: '/workspace/work/src/example.ts', sha256: beforeHash }],
        }),
      /WORKSPACE_FILE_HASH_CONFLICT/,
    );
    staleHashRejections += 1;

    const currentHash = createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
    const misplacedPatch = [
      '--- a/src/example.ts',
      '+++ b/src/example.ts',
      '@@ -10,2 +10,2 @@',
      '-needle fixed',
      '+needle moved',
      ' omega',
      '',
    ].join('\n');
    assert.throws(
      () =>
        applyWorkspacePatch(workRoot, {
          patch: misplacedPatch,
          expectedFiles: [{ path: '/workspace/work/src/example.ts', sha256: currentHash }],
        }),
      /WORKSPACE_PATCH_CONTEXT_MISMATCH/,
      'fuzz=0 must not relocate a hunk away from its declared source location',
    );
    strictLocationRejections += 1;

    const httpJournal = new RunnerJournal(path.join(directory, 'coding-http-journal.json'));
    httpJournal.saveWorkspace({
      workspaceId: 'coding-workspace',
      generation: 5,
      status: 'running',
      retained: false,
      toolchain: [],
      runnerPlugins: [],
      acpProfiles: [],
      browserTarget: null,
    });
    const codingServer = new RunnerControllerServer({
      token: 'coding-token',
      journal: httpJournal,
      runtimeEngine: {
        readWorkspaceFile: (
          _workspaceId: string,
          _generation: number,
          request: Parameters<typeof readWorkspaceFile>[1],
        ) => readWorkspaceFile(workRoot, request),
        searchWorkspace: (_workspaceId: string, _generation: number, request: Parameters<typeof searchWorkspace>[1]) =>
          searchWorkspace(workRoot, request),
        applyWorkspacePatch: (
          _workspaceId: string,
          _generation: number,
          request: Parameters<typeof applyWorkspacePatch>[1],
        ) => applyWorkspacePatch(workRoot, request),
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
        codingServer.once('error', reject);
        codingServer.listen(0, '127.0.0.1', () => {
          const address = codingServer.address();
          if (!address || typeof address === 'string') {
            reject(new Error('SCENARIO_RUNNER_ADDRESS_INVALID'));
            return;
          }
          resolve(`http://127.0.0.1:${address.port}`);
        });
      });
      const adapter = new RunnerHttpAdapter(baseUrl, 'coding-token');
      const httpRead = await adapter.readWorkspaceFile('coding-workspace', 5, {
        path: '/workspace/work/src/example.ts',
        startLine: 2,
        endLine: 2,
        maxBytes: 1024,
      });
      assert.equal(httpRead.content, 'needle fixed');
      const httpSearch = await adapter.searchWorkspace('coding-workspace', 5, {
        query: 'needle fixed',
        path: '/workspace/work/src',
        maxResults: 10,
        contextLines: 0,
        maxOutputBytes: 8 * 1024,
      });
      assert.equal(httpSearch.matches.length, 1);
      const httpPatchText = [
        '--- a/src/example.ts',
        '+++ b/src/example.ts',
        '@@ -1,4 +1,4 @@',
        ' alpha',
        '-needle fixed',
        '+needle http',
        ' omega',
        ' needle again',
        '',
      ].join('\n');
      const httpDryRun = await adapter.applyWorkspacePatch('coding-workspace', 5, {
        patch: httpPatchText,
        expectedFiles: [{ path: '/workspace/work/src/example.ts', sha256: currentHash }],
        dryRun: true,
      });
      assert.equal(httpDryRun.applied, false);
      assert.equal(httpDryRun.changes.length, 1);
      assert.equal(fs.readFileSync(sourcePath, 'utf8'), 'alpha\nneedle fixed\nomega\nneedle again\n');
      httpCodecCases += 3;

      const invalidCodec = await fetch(`${baseUrl}/v1/workspaces/coding-workspace/coding/read-file`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer coding-token',
          'Content-Type': 'application/json',
          'X-Nexus-Agent-Protocol': '2026-09-13',
        },
        body: JSON.stringify({ generation: 5, path: '/workspace/work/src/example.ts', unexpected: true }),
      });
      assert.equal(invalidCodec.status, 400);
      httpCodecCases += 1;
      await assert.rejects(
        () =>
          adapter.readWorkspaceFile('coding-workspace', 4, {
            path: '/workspace/work/src/example.ts',
            maxBytes: 1024,
          }),
        /WORKSPACE_GENERATION_CONFLICT/,
      );
      generationConflictCases += 1;
    } finally {
      await new Promise<void>((resolve, reject) => codingServer.close((error) => (error ? reject(error) : resolve())));
    }

    return [
      { name: 'workspace_read_tools', value: 2, unit: 'tools' },
      { name: 'workspace_patch_tools', value: 1, unit: 'tools' },
      { name: 'workspace_argv_mutation_tools', value: 1, unit: 'tools' },
      { name: 'workspace_read_hash_cases', value: 1, unit: 'cases' },
      { name: 'workspace_traversal_rejections', value: traversalRejections, unit: 'cases' },
      { name: 'workspace_symlink_rejections', value: symlinkRejections, unit: 'cases' },
      { name: 'workspace_fallback_searches', value: fallbackSearches, unit: 'cases' },
      { name: 'workspace_stale_hash_rejections', value: staleHashRejections, unit: 'cases' },
      { name: 'workspace_strict_location_rejections', value: strictLocationRejections, unit: 'cases' },
      { name: 'workspace_patch_change_evidence', value: applied.changes.length, unit: 'files' },
      { name: 'workspace_patch_hash_preconditions', value: 1, unit: 'preconditions' },
      { name: 'workspace_patch_approval_paths', value: 1, unit: 'cases' },
      { name: 'workspace_plan_mode_read_tools', value: 2, unit: 'tools' },
      { name: 'workspace_plan_mode_mutation_tools', value: 0, unit: 'tools' },
      { name: 'workspace_coding_http_codec_cases', value: httpCodecCases, unit: 'cases' },
      { name: 'workspace_coding_generation_conflicts', value: generationConflictCases, unit: 'cases' },
    ];
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
};
