import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { JsonValue } from '../../../packages/backend/src/modules/agent/agent.types';
import { FileCapabilityService } from '../../../packages/backend/src/modules/agent/capabilities/file-capability.service';
import type { SshFileTargetPort } from '../../../packages/backend/src/modules/agent/capabilities/ssh-file-target.port';
import { resolveSshTarget } from '../../../packages/backend/src/modules/agent/capabilities/ssh-target-binding';
import type { SshTargetResolverPort } from '../../../packages/backend/src/modules/agent/capabilities/ssh-target-resolver.port';
import { ToolCatalog } from '../../../packages/backend/src/modules/agent/capabilities/tool-catalog';
import { ToolExecutor } from '../../../packages/backend/src/modules/agent/capabilities/tool-executor';
import type { ToolContext, ToolResult } from '../../../packages/backend/src/modules/agent/capabilities/tool.types';
import { AppCapabilityBroker } from '../../../packages/backend/src/modules/agent/host/app-capability-broker';
import { validateManifest } from '../../../packages/backend/src/modules/agent/host/app-manifest-validator';
import { AppRegistryService } from '../../../packages/backend/src/modules/agent/host/app-registry.service';
import { CapabilityRegistry } from '../../../packages/backend/src/modules/agent/host/capability-registry';
import { createUnifiedFileTools } from '../../../packages/backend/src/modules/agent/tools/host/file-tools';
import { failedToolResult } from '../../../packages/backend/src/modules/agent/runtime/execution/execution-errors';

export const unifiedFileCapabilityScenario = async () => {
  let sshConfigurationHash = 'ssh-config';
  const assertSshConfiguration = (configurationHash: string | undefined): void => {
    if (configurationHash !== sshConfigurationHash) throw new Error('RESOURCE_CHANGED');
  };
  const sshFiles = new Map<string, Buffer>([['/srv/a.txt', Buffer.from('alpha\nneedle\nomega\n', 'utf8')]]);
  const sshDirs = new Set<string>(['/srv']);
  const borrowedSessions: Array<string | undefined> = [];
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
      borrowedSessions.push(_context.sshSessionId);
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
      borrowedSessions.push(_context.sshSessionId);
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

  const targets: SshTargetResolverPort = {
    target: async (_context, connectionId) => {
      if (connectionId !== 1) throw new Error('TARGET_NOT_SELECTED');
      return {
        kind: 'ssh',
        target: 'ssh',
        id: '1',
        connectionId: 1,
        targetIdentity: 'ssh:1',
        endpoint: 'ssh.example:22',
        loginUser: 'tester',
        configurationHash: sshConfigurationHash,
        hostKeyTrust: 'unavailable',
      };
    },
  };

  const service = new FileCapabilityService(targets, sshFileTarget);
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
    stepId: 'file-step',
    signal: new AbortController().signal,
    deadlineAt: Math.floor(Date.now() / 1000) + 60,
    maxOutputBytes: 256 * 1024,
    inputRevision: 1,
  };
  let resolvedSshTargets = 0;
  const canonicalTargets = {
    target: async (_context, connectionId) => {
      resolvedSshTargets++;
      if (connectionId !== 1) throw new Error('TARGET_NOT_SELECTED');
      return {
        kind: 'ssh',
        target: 'ssh',
        id: '1',
        connectionId: 1,
        targetIdentity: 'ssh:1',
        endpoint: 'ssh.example:22',
        loginUser: 'tester',
        configurationHash: sshConfigurationHash,
        hostKeyTrust: 'unavailable',
      };
    },
  } satisfies SshTargetResolverPort;
  for (const invalid of [
    { target: 'workspace', id: 'retired-workspace' },
    { target: 'ssh', id: '0' },
    { target: 'ssh', id: '01' },
    { target: 'ssh', id: '1e3' },
    { target: 'ssh', id: '9007199254740992' },
  ] as const) {
    await assert.rejects(
      resolveSshTarget(canonicalTargets, context, invalid),
      /TOOL_ARGUMENTS_INVALID/,
      'Retired Workspace and noncanonical connection IDs must be rejected before SSH resolution',
    );
  }
  assert.equal(resolvedSshTargets, 0, 'Invalid targets must not consult SSH or Workspace resources');
  const canonicalSsh = await resolveSshTarget(canonicalTargets, context, { target: 'ssh', id: '1' });
  assert.equal(canonicalSsh.connectionId, 1);
  assert.deepEqual(canonicalSsh.resourceKeys, ['connection:1']);
  assert.equal(canonicalSsh.fingerprint.configurationHash, sshConfigurationHash);
  assert.equal(resolvedSshTargets, 1);
  const restoredSsh = service.bindInspectionTarget(canonicalSsh.fingerprint);
  assert.deepEqual(restoredSsh.resourceKeys, ['connection:1']);
  assert.equal(restoredSsh.connectionId, 1);
  for (const invalid of [
    { ...canonicalSsh.fingerprint, kind: 'workspace' as const, target: 'workspace' as const },
    { ...canonicalSsh.fingerprint, id: '01' },
    { ...canonicalSsh.fingerprint, connectionId: 0, id: '0' },
    { ...canonicalSsh.fingerprint, connectionId: 2 },
  ]) {
    assert.throws(
      () => service.bindInspectionTarget(invalid),
      /TOOL_STATE_CONFLICT/,
      'Persisted inspections cannot manufacture an SSH binding with mismatched identity',
    );
  }
  assert.equal(resolvedSshTargets, 1, 'Restoring inspections must not resolve a different SSH connection');
  const invoke = async (name: string, input: JsonValue): Promise<ToolResult> => {
    const tool = tools.get(name);
    assert.ok(tool, `${name} must be registered`);
    const inspection = await tool.inspect(input, context, 7);
    return tool.execute(inspection, context);
  };

  {
    const readTool = tools.get('file_read')!;
    const args = { target: 'ssh', id: '1', path: '/srv/a.txt' };
    const temporary = await readTool.inspect(args, context, 7);
    const persistent = await readTool.inspect({ ...args, sessionId: 'explicit-session' }, context, 7);
    assert.notEqual(temporary.operationHash, persistent.operationHash);
    borrowedSessions.length = 0;
    await readTool.execute(persistent, context);
    assert.ok(borrowedSessions.length > 0);
    assert.ok(
      borrowedSessions.every((id) => id === 'explicit-session'),
      'inspection/execution must preserve the selected session',
    );
    const observedCalls = borrowedSessions.length;
    await assert.rejects(
      () => invoke('file_read', { target: 'workspace', id: 'ws-file', path: '/srv/a.txt' }),
      /FILE_ARGUMENT_TARGET_INVALID/,
    );
    assert.equal(borrowedSessions.length, observedCalls, 'retired target must not access SSH files');
    for (const target of [{ target: 'ssh' as const, id: '1', root: '/srv' }]) {
      const source = `${target.root}/a.txt`;
      const created = `${target.root}/created.txt`;
      const moved = `${target.root}/moved.txt`;
      const missing = `${target.root}/missing.txt`;
      const beforeState = inspectSsh(source);
      const canary = 'PRIVATE_FILE_ARGUMENT_CANARY';
      for (const fixture of [
        {
          name: 'file_read',
          args: { path: source, offsetBytes: -1 },
          code: 'FILE_ARGUMENT_INTEGER_INVALID',
          detail: 'offsetBytes',
        },
        {
          name: 'file_read',
          args: { path: source, maxBytes: 65537 },
          code: 'FILE_ARGUMENT_INTEGER_INVALID',
          detail: 'maxBytes',
        },
        {
          name: 'file_list',
          args: { path: target.root, maxEntries: 0 },
          code: 'FILE_ARGUMENT_INTEGER_INVALID',
          detail: 'maxEntries',
        },
        {
          name: 'file_search',
          args: { path: source, query: canary, contextLines: 6 },
          code: 'FILE_ARGUMENT_INTEGER_INVALID',
          detail: 'contextLines',
        },
        {
          name: 'file_search',
          args: { path: source, query: '', maxResults: 20 },
          code: 'FILE_ARGUMENT_STRING_INVALID',
          detail: 'query',
        },
        {
          name: 'file_write',
          args: { path: missing, content: canary, mode: 512 },
          code: 'FILE_ARGUMENT_INTEGER_INVALID',
          detail: 'mode',
        },
        {
          name: 'file_write',
          args: { path: missing, content: canary + '\0' },
          code: 'FILE_ARGUMENT_CONTENT_INVALID',
          detail: 'content',
        },
        {
          name: 'file_move',
          args: { path: source, destinationPath: '' },
          code: 'FILE_ARGUMENT_STRING_INVALID',
          detail: 'destinationPath',
        },
        {
          name: 'file_delete',
          args: { path: source, recursive: canary },
          code: 'FILE_ARGUMENT_BOOLEAN_INVALID',
          detail: 'recursive',
        },
        {
          name: 'file_read',
          args: { path: source, extra: canary },
          code: 'FILE_ARGUMENT_FIELD_UNSUPPORTED',
          detail: 'schema',
        },
        { name: 'file_search', args: { path: missing, query: canary }, code: 'FILE_NOT_FOUND', detail: 'path' },
      ]) {
        await assert.rejects(
          () => invoke(fixture.name, { target: target.target, id: target.id, ...fixture.args } as JsonValue),
          (error: unknown) => {
            const result = failedToolResult(error, {
              fallbackCode: 'TOOL_ARGUMENTS_INVALID',
              summaryPrefix: 'Rejected',
              verificationSummary: 'Not executed.',
            });
            assert.equal(result.errorCode, fixture.code);
            assert.ok(result.summary.includes(fixture.detail));
            assert.equal(JSON.stringify(result).includes(canary), false);
            return true;
          },
        );
      }
      const missingAfterReject = inspectSsh(missing);
      assert.equal(missingAfterReject.exists, false, 'Invalid file writes must not create a destination');
      for (const fixture of [
        {
          name: 'file_write',
          args: { path: target.root, content: 'must-not-write' },
          code: 'FILE_WRITE_REQUIRES_FILE',
        },
        { name: 'file_move', args: { path: missing, destinationPath: moved }, code: 'FILE_NOT_FOUND' },
        { name: 'file_move', args: { path: source, destinationPath: source }, code: 'FILE_MOVE_SAME_PATH' },
        {
          name: 'file_move',
          args: { path: source, destinationPath: target.root },
          code: 'FILE_MOVE_DESTINATION_EXISTS',
        },
        { name: 'file_delete', args: { path: missing }, code: 'FILE_NOT_FOUND' },
      ]) {
        await assert.rejects(
          () => invoke(fixture.name, { target: target.target, id: target.id, ...fixture.args } as JsonValue),
          (error: unknown) => {
            const result = failedToolResult(error, {
              fallbackCode: 'TOOL_ARGUMENTS_INVALID',
              summaryPrefix: 'Rejected',
              verificationSummary: 'Not executed.',
            });
            assert.equal(result.errorCode, fixture.code);
            assert.equal(result.ok, false);
            assert.equal(result.verification.status, 'failed');
            assert.equal(result.summary.includes(source), false, 'Correction details must not echo input paths');
            return true;
          },
        );
      }
      const afterState = inspectSsh(source);
      assert.deepEqual(
        afterState,
        beforeState,
        'Rejected operations must preserve the original file identity and hash',
      );
      const read = await invoke('file_read', { target: target.target, id: target.id, path: source });
      assert.equal(read.ok, true);
      assert.match(String((read.data as Record<string, JsonValue>).content), /needle/);
      const listed = await invoke('file_list', { target: target.target, id: target.id, path: target.root });
      assert.equal(listed.ok, true);
      await assert.rejects(
        () => invoke('file_read', { target: target.target, id: target.id, path: target.root }),
        /FILE_READ_REQUIRES_FILE/,
      );
      await assert.rejects(
        () => invoke('file_list', { target: target.target, id: target.id, path: source }),
        /FILE_LIST_REQUIRES_DIRECTORY/,
      );
      const searched = await invoke('file_search', {
        target: target.target,
        id: target.id,
        path: target.root,
        query: 'needle',
      });
      assert.equal(((searched.data as Record<string, JsonValue>).matches as JsonValue[]).length, 1);
      const globSearch = await invoke('file_search', {
        target: target.target,
        id: target.id,
        path: target.root,
        query: 'needle',
        glob: '{a,b}.txt',
      });
      assert.equal(((globSearch.data as Record<string, JsonValue>).matches as JsonValue[]).length, 1);
      const writeInput = { target: target.target, id: target.id, path: created, content: 'created\n' };
      await invoke('file_write', writeInput);
      const patch = `--- ${source}\n+++ ${source}\n@@ -1,3 +1,3 @@\n-alpha\n+ALPHA\n needle\n omega\n`;
      const patched = await invoke('file_patch', { target: target.target, id: target.id, patch });
      assert.equal(patched.ok, true);
      const reread = await invoke('file_read', { target: target.target, id: target.id, path: source });
      assert.match(String((reread.data as Record<string, JsonValue>).content), /^ALPHA/m);
      await invoke('file_move', { target: target.target, id: target.id, path: created, destinationPath: moved });
      await invoke('file_delete', { target: target.target, id: target.id, path: moved });
      const afterDelete = inspectSsh(moved);
      assert.equal(afterDelete.exists, false);
    }

    const fileWriteTool = tools.get('file_write')!;
    const fileReadTool = tools.get('file_read')!;
    const privateWrite = await fileWriteTool.inspect(
      { target: 'ssh', id: '1', path: '/srv/mode-hash.txt', content: '', mode: 0o600 },
      context,
      7,
    );
    const sharedWrite = await fileWriteTool.inspect(
      { target: 'ssh', id: '1', path: '/srv/mode-hash.txt', content: '', mode: 0o644 },
      context,
      7,
    );
    assert.notEqual(privateWrite.operationHash, sharedWrite.operationHash, 'SSH mode requires new approval');
    await assert.rejects(
      () =>
        fileWriteTool.inspect(
          { target: 'workspace', id: 'ws-file', path: '/srv/invalid.txt', content: 'must-not-write' },
          context,
          7,
        ),
      /FILE_ARGUMENT_TARGET_INVALID/,
    );

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
    for (const capability of ['file.read', 'file.write', 'file.delete', 'shell.execute'] as const) {
      assert.deepEqual(
        capabilityRegistry.require(capability).supportedTargets,
        ['ssh'],
        'File/Shell capability grants must expose only SSH connections',
      );
      assert.deepEqual(capabilityRegistry.defaultScope(capability), {
        kind: 'targets',
        targets: { ssh: { mode: 'all' } },
      });
      for (const rejectedTargets of [
        { workspace: { mode: 'all' } },
        { workspace: { mode: 'all' }, ssh: { mode: 'all' } },
      ]) {
        assert.throws(
          () => capabilityRegistry.parseScope(capability, { kind: 'targets', targets: rejectedTargets }),
          /APP_GRANT_SCOPE_INVALID/,
          'Legacy Workspace grants must be rejected without normalization or SSH escalation',
        );
      }
      assert.equal(
        capabilityRegistry.allows(capability, capabilityRegistry.defaultScope(capability), {
          target: 'workspace',
          id: 'legacy-workspace',
        }),
        false,
        'An SSH grant cannot authorize the old Workspace target',
      );
    }
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
      capabilityRegistry.grant('file.read', { kind: 'targets', targets: { ssh: { mode: 'ids', ids: ['1'] } } }, 1),
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
    const sshProposal = {
      providerCallId: 'file-ssh-read',
      name: 'file_read',
      argumentsJson: JSON.stringify({ target: 'ssh', id: '1', path: '/srv/a.txt' }),
    };
    const authorizedRead = await executor.invoke(context, sshProposal);
    assert.equal(authorizedRead.result.ok, true, 'Authorized SSH file read must complete');
    await assert.rejects(
      () =>
        executor.inspect(context, {
          providerCallId: 'file-ungranted-ssh-read',
          name: 'file_read',
          argumentsJson: JSON.stringify({ target: 'ssh', id: '2', path: '/srv/a.txt' }),
        }),
      /APP_CAPABILITY_DENIED/,
      'an SSH id-specific file grant must not authorize another SSH connection',
    );
    const staleInspection = await executor.inspect(context, sshProposal);
    brokerGrants = [
      capabilityRegistry.grant('file.read', { kind: 'targets', targets: { ssh: { mode: 'ids', ids: ['2'] } } }, 2),
    ];
    await assert.rejects(
      () => executor.execute(context, staleInspection),
      /POLICY_REVISION_CONFLICT/,
      'Reauthorization must reject narrowed SSH grants after inspection',
    );

    return [
      { name: 'unified_file_targets', value: 1, unit: 'targets' },
      { name: 'unified_file_operations', value: 7, unit: 'operations' },
      { name: 'unified_file_broker_scope_rejections', value: 2, unit: 'cases' },
      { name: 'unified_file_frozen_target_stale_rejections', value: 2, unit: 'cases' },
      { name: 'unified_file_legacy_branches', value: 0, unit: 'branches' },
      { name: 'unified_file_resolver_retired_target_rejections', value: 5, unit: 'cases' },
      { name: 'unified_file_binding_forgery_rejections', value: 4, unit: 'cases' },
    ];
  }
};
