import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applyWorkspacePatch,
  deleteWorkspaceFile,
  listWorkspaceFiles,
  moveWorkspaceFile,
  readWorkspaceFile,
  searchWorkspace,
  statWorkspacePath,
  writeWorkspaceFile,
} from '../../../packages/agent-runner/src/controller/workspace-coding-files';
import { WorkspaceFileTargetAdapter } from '../../../packages/backend/src/infrastructure/agent/workspace-runtime/workspace-file-target.adapter';
import type { JsonValue } from '../../../packages/backend/src/modules/agent/agent.types';
import { FileCapabilityService } from '../../../packages/backend/src/modules/agent/capabilities/file-capability.service';
import type { SshFileTargetPort } from '../../../packages/backend/src/modules/agent/capabilities/ssh-file-target.port';
import { AgentTargetResolver } from '../../../packages/backend/src/modules/agent/capabilities/target-resolver';
import { ToolCatalog } from '../../../packages/backend/src/modules/agent/capabilities/tool-catalog';
import { ToolExecutor } from '../../../packages/backend/src/modules/agent/capabilities/tool-executor';
import type { ToolContext, ToolResult } from '../../../packages/backend/src/modules/agent/capabilities/tool.types';
import { AppCapabilityBroker } from '../../../packages/backend/src/modules/agent/host/app-capability-broker';
import { validateManifest } from '../../../packages/backend/src/modules/agent/host/app-manifest-validator';
import { AppRegistryService } from '../../../packages/backend/src/modules/agent/host/app-registry.service';
import { CapabilityRegistry } from '../../../packages/backend/src/modules/agent/host/capability-registry';
import { createUnifiedFileTools } from '../../../packages/backend/src/modules/agent/tools/host/file-tools';
import type { AgentWorkspaceRepositoryPort } from '../../../packages/backend/src/modules/agent/workspace-runtime/workspace-runtime.repository.port';
import type { WorkspaceRuntimeControllerPort } from '../../../packages/backend/src/modules/agent/workspace-runtime/workspace-runtime-controller.port';

export const unifiedFileCapabilityScenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-unified-file-'));
  const workRoot = path.join(directory, 'work');
  fs.mkdirSync(workRoot, { recursive: true });
  fs.writeFileSync(path.join(workRoot, 'a.txt'), 'alpha\nneedle\nomega\n', 'utf8');

  let workspaceGeneration = 1;
  const workspaceFileRepository = {
    getWorkspace: async () => ({
      userId: 1,
      appId: 'scenario.unified-file',
      id: 'ws-file',
      runId: 'file-run',
      agentRuntimeId: 'file-runtime',
      retained: false,
      profile: {
        kind: 'code' as const,
        recipeId: 'file-recipe',
        recipeRevision: '1',
        runtimeDigest: 'file-runtime-digest',
        catalogRevision: 'file-catalog',
        toolchain: [],
        runnerPlugins: [],
        acpProfiles: [],
        browserTarget: null,
      },
      generation: workspaceGeneration,
      status: 'running' as const,
      retainedManifestRef: null,
      version: 1,
      lastActiveAt: 1_800_000_000,
      createdAt: 1_800_000_000,
      updatedAt: 1_800_000_000,
    }),
  } as unknown as AgentWorkspaceRepositoryPort;
  const workspaceFileController = {
    statWorkspacePath: async (_workspaceId: string, _generation: number, requestedPath: string) =>
      statWorkspacePath(workRoot, requestedPath),
    readWorkspaceFile: async (
      _workspaceId: string,
      _generation: number,
      request: Parameters<typeof readWorkspaceFile>[1],
    ) => readWorkspaceFile(workRoot, request),
    writeWorkspaceFile: async (
      _workspaceId: string,
      _generation: number,
      request: Parameters<typeof writeWorkspaceFile>[1],
    ) => writeWorkspaceFile(workRoot, request),
    listWorkspaceFiles: async (
      _workspaceId: string,
      _generation: number,
      request: Parameters<typeof listWorkspaceFiles>[1],
    ) => listWorkspaceFiles(workRoot, request),
    searchWorkspace: async (
      _workspaceId: string,
      _generation: number,
      request: Parameters<typeof searchWorkspace>[1],
    ) => searchWorkspace(workRoot, request),
    moveWorkspaceFile: async (
      _workspaceId: string,
      _generation: number,
      request: Parameters<typeof moveWorkspaceFile>[1],
    ) => moveWorkspaceFile(workRoot, request),
    deleteWorkspaceFile: async (
      _workspaceId: string,
      _generation: number,
      request: Parameters<typeof deleteWorkspaceFile>[1],
    ) => deleteWorkspaceFile(workRoot, request),
    applyWorkspacePatch: async (
      _workspaceId: string,
      _generation: number,
      request: Parameters<typeof applyWorkspacePatch>[1],
    ) => applyWorkspacePatch(workRoot, request),
  } as unknown as WorkspaceRuntimeControllerPort;
  const workspaceFileTarget = new WorkspaceFileTargetAdapter(workspaceFileRepository, workspaceFileController);

  let sshConfigurationHash = 'ssh-config';
  const assertSshConfiguration = (configurationHash: string | undefined): void => {
    if (configurationHash !== sshConfigurationHash) throw new Error('RESOURCE_CHANGED');
  };
  const sshFiles = new Map<string, Buffer>([['/srv/a.txt', Buffer.from('alpha\nneedle\nomega\n', 'utf8')]]);
  const sshDirs = new Set<string>(['/srv']);
  const fileHash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
  const inspectSsh = (requestedPath: string) => {
    const content = sshFiles.get(requestedPath);
    if (content)
      return {
        path: requestedPath,
        resolvedPath: requestedPath,
        exists: true,
        type: 'file' as const,
        sizeBytes: content.byteLength,
        modifiedAt: 1,
        mode: 0o600,
        sha256: fileHash(content),
      };
    if (sshDirs.has(requestedPath))
      return {
        path: requestedPath,
        resolvedPath: requestedPath,
        exists: true,
        type: 'directory' as const,
        sizeBytes: 0,
        modifiedAt: 1,
        mode: 0o700,
        sha256: null,
      };
    return {
      path: requestedPath,
      resolvedPath: requestedPath,
      exists: false,
      type: null,
      sizeBytes: null,
      modifiedAt: null,
      mode: null,
      sha256: null,
    };
  };
  const sshFileTarget = {
    stat: async (_context: ToolContext, connectionId: number, requestedPath: string, configurationHash: string) => {
      assert.equal(connectionId, 1);
      assertSshConfiguration(configurationHash);
      return inspectSsh(requestedPath);
    },
    read: async (
      _context: ToolContext,
      connectionId: number,
      requestedPath: string,
      maxBytes: number,
      offset = 0,
      configurationHash?: string,
    ) => {
      assert.equal(connectionId, 1);
      assertSshConfiguration(configurationHash);
      const content = sshFiles.get(requestedPath);
      if (!content) throw new Error('NOT_FOUND');
      const bytes = content.subarray(offset, Math.min(content.byteLength, offset + maxBytes));
      return {
        path: requestedPath,
        resolvedPath: requestedPath,
        sizeBytes: content.byteLength,
        modifiedAt: 1,
        offset,
        bytesRead: bytes.byteLength,
        truncated: offset + bytes.byteLength < content.byteLength,
        content: bytes.toString('utf8'),
      };
    },
    list: async (
      _context: ToolContext,
      connectionId: number,
      requestedPath: string,
      maxEntries: number,
      configurationHash: string,
    ) => {
      assert.equal(connectionId, 1);
      assertSshConfiguration(configurationHash);
      const entries = [...sshFiles.keys()]
        .filter((candidate) => path.posix.dirname(candidate) === requestedPath)
        .sort()
        .slice(0, maxEntries)
        .map((candidate) => {
          const content = sshFiles.get(candidate)!;
          return {
            name: path.posix.basename(candidate),
            path: candidate,
            type: 'file' as const,
            sizeBytes: content.byteLength,
            modifiedAt: 1,
          };
        });
      return { path: requestedPath, entries, truncated: false };
    },
    search: async (
      _context: ToolContext,
      connectionId: number,
      request: { query: string; path: string; maxResults: number; contextLines: number },
      configurationHash: string,
    ) => {
      assert.equal(connectionId, 1);
      assertSshConfiguration(configurationHash);
      const expression = new RegExp(request.query, 'u');
      const matches: Array<{
        path: string;
        line: number;
        column: number;
        text: string;
        before: string[];
        after: string[];
      }> = [];
      let scannedBytes = 0;
      for (const [candidate, bytes] of sshFiles) {
        if (!candidate.startsWith(`${request.path}/`) && candidate !== request.path) continue;
        scannedBytes += bytes.byteLength;
        const lines = bytes.toString('utf8').split('\n');
        for (let index = 0; index < lines.length && matches.length < request.maxResults; index += 1) {
          const found = expression.exec(lines[index]!);
          if (!found) continue;
          matches.push({
            path: candidate,
            line: index + 1,
            column: found.index + 1,
            text: lines[index]!,
            before: lines.slice(Math.max(0, index - request.contextLines), index),
            after: lines.slice(index + 1, index + 1 + request.contextLines),
          });
        }
      }
      return {
        query: request.query,
        path: request.path,
        engine: 'sftp' as const,
        matches,
        truncated: false,
        scannedFiles: sshFiles.size,
        scannedBytes,
      };
    },
    write: async (
      _context: ToolContext,
      connectionId: number,
      requestedPath: string,
      content: Uint8Array,
      expectedSha256: string | null,
      configurationHash: string,
    ) => {
      assert.equal(connectionId, 1);
      assertSshConfiguration(configurationHash);
      const before = sshFiles.get(requestedPath);
      assert.equal(before ? fileHash(before) : null, expectedSha256);
      const bytes = Buffer.from(content);
      sshFiles.set(requestedPath, bytes);
      return {
        path: requestedPath,
        resolvedPath: requestedPath,
        exists: true,
        type: 'file' as const,
        sizeBytes: bytes.byteLength,
        modifiedAt: 2,
        mode: 0o600,
        sha256: fileHash(bytes),
        bytesWritten: bytes.byteLength,
      };
    },
    move: async (
      _context: ToolContext,
      connectionId: number,
      source: string,
      destination: string,
      expectedSha256: string | null,
      configurationHash: string,
    ) => {
      assert.equal(connectionId, 1);
      assertSshConfiguration(configurationHash);
      const bytes = sshFiles.get(source);
      if (!bytes) throw new Error('NOT_FOUND');
      assert.equal(fileHash(bytes), expectedSha256);
      assert.equal(sshFiles.has(destination), false);
      sshFiles.delete(source);
      sshFiles.set(destination, bytes);
      return { path: source, destinationPath: destination, type: 'file' as const, sha256: fileHash(bytes) };
    },
    delete: async (
      _context: ToolContext,
      connectionId: number,
      requestedPath: string,
      _recursive: boolean,
      expectedSha256: string | null,
      configurationHash: string,
    ) => {
      assert.equal(connectionId, 1);
      assertSshConfiguration(configurationHash);
      const bytes = sshFiles.get(requestedPath);
      if (!bytes) throw new Error('NOT_FOUND');
      assert.equal(fileHash(bytes), expectedSha256);
      sshFiles.delete(requestedPath);
      return { path: requestedPath, type: 'file' as const, deleted: true as const };
    },
    replace: async (
      _context: ToolContext,
      connectionId: number,
      replacements: readonly { path: string; content: Uint8Array; expectedSha256: string }[],
      configurationHash: string,
    ) => {
      assert.equal(connectionId, 1);
      assertSshConfiguration(configurationHash);
      for (const replacement of replacements) {
        const before = sshFiles.get(replacement.path);
        if (!before || fileHash(before) !== replacement.expectedSha256) throw new Error('RESOURCE_CHANGED');
      }
      return replacements.map((replacement) => {
        const bytes = Buffer.from(replacement.content);
        sshFiles.set(replacement.path, bytes);
        return { path: replacement.path, sha256: fileHash(bytes), sizeBytes: bytes.byteLength };
      });
    },
  } as unknown as SshFileTargetPort;

  const targets = {
    resolve: async (_context: ToolContext, selector: { target: 'workspace' | 'ssh'; id: string }) =>
      selector.target === 'workspace'
        ? {
            selector,
            fingerprint: {
              kind: 'workspace' as const,
              target: 'workspace' as const,
              id: selector.id,
              workspaceId: selector.id,
              generation: workspaceGeneration,
              targetIdentity: `workspace:${selector.id}:${workspaceGeneration}`,
              endpoint: `workspace:${selector.id}`,
              loginUser: 'runner:65532',
              configurationHash: `workspace-config-${workspaceGeneration}`,
            },
            resourceKeys: [`workspace:${selector.id}:${workspaceGeneration}`],
            preconditions: [
              {
                kind: 'workspaceGeneration' as const,
                key: selector.id,
                observedValue: { generation: workspaceGeneration },
              },
            ],
            workspaceGeneration,
          }
        : {
            selector,
            fingerprint: {
              kind: 'ssh' as const,
              target: 'ssh' as const,
              id: selector.id,
              connectionId: 1,
              targetIdentity: 'ssh:1',
              endpoint: 'ssh.example:22',
              loginUser: 'tester',
              configurationHash: sshConfigurationHash,
              hostKeyTrust: 'unavailable' as const,
            },
            resourceKeys: ['connection:1'],
            preconditions: [],
            connectionId: 1,
          },
  } as unknown as AgentTargetResolver;

  const service = new FileCapabilityService(targets, workspaceFileTarget, sshFileTarget);
  const cryptoHash = { sha256Utf8: (value: string) => createHash('sha256').update(value, 'utf8').digest('hex') };
  const tools = new Map(createUnifiedFileTools(service, cryptoHash).map((tool) => [tool.descriptor.name, tool]));
  const context: ToolContext = {
    userId: 1,
    appId: 'scenario.unified-file',
    actor: {
      kind: 'agent',
      userId: 1,
      appId: 'scenario.unified-file',
      runId: 'file-run',
      agentRuntimeId: 'file-runtime',
    },
    runId: 'file-run',
    agentRuntimeId: 'file-runtime',
    connectionIds: [1],
    environment: null,
    stepId: 'file-step',
    signal: new AbortController().signal,
    deadlineAt: Math.floor(Date.now() / 1000) + 60,
    maxOutputBytes: 256 * 1024,
    inputRevision: 1,
  };
  const invoke = async (name: string, input: JsonValue): Promise<ToolResult> => {
    const tool = tools.get(name);
    assert.ok(tool, `${name} must be registered`);
    const inspection = await tool.inspect(input, context, 7);
    return tool.execute(inspection, context);
  };

  try {
    for (const target of [
      { target: 'workspace' as const, id: 'ws-file', root: '/workspace/work' },
      { target: 'ssh' as const, id: '1', root: '/srv' },
    ]) {
      const source = `${target.root}/a.txt`;
      const created = `${target.root}/created.txt`;
      const moved = `${target.root}/moved.txt`;
      const read = await invoke('file_read', { target: target.target, id: target.id, path: source });
      assert.equal(read.ok, true);
      assert.match(String((read.data as Record<string, JsonValue>).content), /needle/);
      const listed = await invoke('file_list', { target: target.target, id: target.id, path: target.root });
      assert.equal(listed.ok, true);
      const searched = await invoke('file_search', {
        target: target.target,
        id: target.id,
        path: target.root,
        query: 'needle',
      });
      assert.equal(((searched.data as Record<string, JsonValue>).matches as JsonValue[]).length, 1);
      await invoke('file_write', { target: target.target, id: target.id, path: created, content: 'created\n' });
      const patch = `--- ${source}\n+++ ${source}\n@@ -1,3 +1,3 @@\n-alpha\n+ALPHA\n needle\n omega\n`;
      const patched = await invoke('file_patch', { target: target.target, id: target.id, patch });
      assert.equal(patched.ok, true);
      const reread = await invoke('file_read', { target: target.target, id: target.id, path: source });
      assert.match(String((reread.data as Record<string, JsonValue>).content), /^ALPHA/m);
      await invoke('file_move', { target: target.target, id: target.id, path: created, destinationPath: moved });
      await invoke('file_delete', { target: target.target, id: target.id, path: moved });
      const afterDelete = target.target === 'workspace' ? statWorkspacePath(workRoot, moved) : inspectSsh(moved);
      assert.equal(afterDelete.exists, false);
    }

    const fileWriteTool = tools.get('file_write');
    const fileReadTool = tools.get('file_read');
    assert.ok(fileWriteTool && fileReadTool);

    const frozenWorkspaceWrite = await fileWriteTool.inspect(
      { target: 'workspace', id: 'ws-file', path: '/workspace/work/stale-generation.txt', content: 'must-not-write\n' },
      context,
      7,
    );
    workspaceGeneration = 2;
    await assert.rejects(
      () => fileWriteTool.execute(frozenWorkspaceWrite, context),
      /WORKSPACE_GENERATION_CONFLICT/,
      'file execution must keep the inspected Workspace generation pinned instead of rebinding target + id after inspection',
    );
    assert.equal(
      statWorkspacePath(workRoot, '/workspace/work/stale-generation.txt').exists,
      false,
      'a stale Workspace generation must not receive the approved write',
    );
    workspaceGeneration = 1;

    const frozenSshWrite = await fileWriteTool.inspect(
      { target: 'ssh', id: '1', path: '/srv/stale-config.txt', content: 'must-not-write\n' },
      context,
      7,
    );
    sshConfigurationHash = 'ssh-config-v2';
    await assert.rejects(
      () => fileWriteTool.execute(frozenSshWrite, context),
      /RESOURCE_CHANGED/,
      'file mutation execution must keep the inspected SSH configuration hash pinned instead of rebinding to a changed Connection',
    );
    assert.equal(
      sshFiles.has('/srv/stale-config.txt'),
      false,
      'a stale SSH configuration must not receive the approved write',
    );
    sshConfigurationHash = 'ssh-config';

    const frozenSshRead = await fileReadTool.inspect({ target: 'ssh', id: '1', path: '/srv/a.txt' }, context, 7);
    sshConfigurationHash = 'ssh-config-v3';
    await assert.rejects(
      () => fileReadTool.execute(frozenSshRead, context),
      /RESOURCE_CHANGED/,
      'read execution must also consume the inspected SSH fingerprint instead of silently rebinding after inspection',
    );
    sshConfigurationHash = 'ssh-config';

    const capabilityRegistry = new CapabilityRegistry();
    const appRegistry = new AppRegistryService();
    appRegistry.registerVersion({
      manifest: validateManifest(
        {
          schemaVersion: 1,
          id: context.appId,
          version: '1.0.0',
          displayName: 'Unified file scenario',
          sdkVersion: '1.0.0',
          nexus: { minVersion: '1.0.0', maxVersion: '99.0.0' },
          capabilities: ['file.read', 'file.write', 'file.delete'],
          intents: [],
        },
        { nexusVersion: '1.0.0', supportedSdkMajor: 1 },
      ),
      defaultEnabled: true,
      defaultGrants: [],
    });
    let brokerGrants = [
      capabilityRegistry.grant(
        'file.read',
        { kind: 'targets', targets: { workspace: { mode: 'ids', ids: ['ws-file'] } } },
        1,
      ),
    ];
    const broker = new AppCapabilityBroker(
      appRegistry,
      {
        get: async () => ({
          userId: context.userId,
          appId: context.appId,
          activeVersion: '1.0.0',
          desiredState: 'enabled',
          observedState: 'running',
          healthReason: null,
          policyRevision: 7,
          runningCount: 1,
          approvalCount: 0,
          budgetRequestCount: 0,
          acceptNewRuns: true,
          version: 1,
          createdAt: 1,
          updatedAt: 1,
        }),
      } as never,
      { list: async () => brokerGrants } as never,
      { isDenied: async () => false } as never,
      capabilityRegistry,
    );
    const authorizedCatalog = new ToolCatalog();
    authorizedCatalog.registerContribution({
      schemaVersion: 1,
      id: 'scenario.unified-file-authorized',
      tools: createUnifiedFileTools(service, cryptoHash),
    });
    const executor = new ToolExecutor(authorizedCatalog, broker);
    const workspaceProposal = {
      providerCallId: 'file-workspace-read',
      name: 'file_read',
      argumentsJson: JSON.stringify({ target: 'workspace', id: 'ws-file', path: '/workspace/work/a.txt' }),
    };
    const authorizedRead = await executor.invoke(context, workspaceProposal);
    assert.equal(authorizedRead.result.ok, true, 'ToolExecutor/AppCapabilityBroker must allow a matching target grant');
    await assert.rejects(
      () =>
        executor.inspect(context, {
          providerCallId: 'file-ssh-read',
          name: 'file_read',
          argumentsJson: JSON.stringify({ target: 'ssh', id: '1', path: '/srv/a.txt' }),
        }),
      /APP_CAPABILITY_DENIED/,
      'a Workspace-only file.read grant must not authorize the same canonical Tool against SSH',
    );
    const staleInspection = await executor.inspect(context, workspaceProposal);
    brokerGrants = [
      capabilityRegistry.grant(
        'file.read',
        { kind: 'targets', targets: { workspace: { mode: 'ids', ids: ['other-workspace'] } } },
        2,
      ),
    ];
    await assert.rejects(
      () => executor.execute(context, staleInspection),
      /POLICY_REVISION_CONFLICT/,
      'ToolExecutor must re-authorize the inspected target before execution so a narrowed grant cannot be bypassed',
    );

    return [
      { name: 'unified_file_targets', value: 2, unit: 'targets' },
      { name: 'unified_file_operations', value: 7, unit: 'operations' },
      { name: 'unified_file_broker_scope_rejections', value: 2, unit: 'cases' },
      { name: 'unified_file_frozen_target_stale_rejections', value: 3, unit: 'cases' },
      { name: 'unified_file_legacy_branches', value: 0, unit: 'branches' },
    ];
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
};
