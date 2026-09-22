import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createAgentConnectionResolver } from '../../../packages/backend/src/bootstrap/agent/machine-support';
import { SshTargetAdapter } from '../../../packages/backend/src/infrastructure/agent/capabilities/ssh-target.adapter';
import { ConnectionCredentialService } from '../../../packages/backend/src/modules/connections/connection-credential.service';
import type {
  ConnectionRepository,
  StoredConnectionRecord,
} from '../../../packages/backend/src/modules/connections/connection.repository.port';
import type { ConnectionService } from '../../../packages/backend/src/modules/connections/connection.service';
import type { Connection } from '../../../packages/backend/src/modules/connections/connection.types';
import { SshConnectionResolver } from '../../../packages/backend/src/modules/connections/services/ssh-connection-resolver.service';
import type {
  ProxyRepository,
  StoredProxyRecord,
} from '../../../packages/backend/src/modules/proxies/proxy.repository.port';
import { ProxyService } from '../../../packages/backend/src/modules/proxies/proxy.service';
import type {
  SshKeyRepository,
  StoredSshKeyRecord,
} from '../../../packages/backend/src/modules/ssh-keys/ssh-key.repository.port';
import { SshKeyService } from '../../../packages/backend/src/modules/ssh-keys/ssh-key.service';
import type { SecretCipher } from '../../../packages/backend/src/shared/security/crypto.port';
import type { Scope } from '../../../packages/backend/src/modules/agent/agent.types';
import { ToolCatalog } from '../../../packages/backend/src/modules/agent/capabilities/tool-catalog';
import { modelFacingToolSchemas } from '../../../packages/backend/src/modules/agent/capabilities/tool-model-surface';
import type { ToolContext } from '../../../packages/backend/src/modules/agent/capabilities/tool.types';
import { createUnifiedFileTools } from '../../../packages/backend/src/modules/agent/tools/host/file-tools';
import type { TargetDenylistRepositoryPort } from '../../../packages/backend/src/modules/agent/host/target-denylist.repository.port';
import {
  createConnectionListTool,
  createDiagnosticsTool,
} from '../../../packages/backend/src/modules/agent/tools/host/tools';
import { createDockerMutationTool } from '../../../packages/backend/src/modules/agent/tools/host/mutation-tools';
import { createUnifiedShellTools } from '../../../packages/backend/src/modules/agent/tools/host/shell-tools';
import { contextService } from './scenario-context-helpers';

export const machineRouteDependencyApprovalScenario = async () => {
  const availabilityScope: Scope = { userId: 1, appId: 'machine-availability-app' };
  const availabilityCatalog = new ToolCatalog();
  const availabilityCryptoHash = {
    sha256Utf8: (value: string) => createHash('sha256').update(value, 'utf8').digest('hex'),
  };
  availabilityCatalog.registerContribution({
    schemaVersion: 1,
    id: 'scenario.machine-availability',
    tools: [
      createConnectionListTool(null!, availabilityCryptoHash),
      createDiagnosticsTool(null!, null!, availabilityCryptoHash),
      createDockerMutationTool(null!, null!, availabilityCryptoHash),
    ],
  });
  availabilityCatalog.registerContribution({
    schemaVersion: 1,
    id: 'scenario.file-availability',
    tools: createUnifiedFileTools(null!, availabilityCryptoHash),
  });
  availabilityCatalog.registerContribution({
    schemaVersion: 1,
    id: 'scenario.shell-availability',
    tools: createUnifiedShellTools(null!, availabilityCryptoHash),
  });
  const withoutTarget = new Set(
    modelFacingToolSchemas(
      availabilityCatalog,
      availabilityScope,
      { environment: null, connectionIds: [] },
      'execute',
    ).map((tool) => tool.name),
  );
  assert.ok(
    withoutTarget.has('machine_list_connections'),
    'connection discovery remains available without a frozen target',
  );
  for (const toolName of ['machine_diagnostics', 'file_read', 'file_write', 'shell_execute', 'machine_docker_action']) {
    assert.equal(
      withoutTarget.has(toolName),
      false,
      `${toolName} must not be model-visible when the Run froze no selected connections`,
    );
  }
  const withTarget = new Set(
    modelFacingToolSchemas(
      availabilityCatalog,
      availabilityScope,
      { environment: null, connectionIds: [1] },
      'execute',
    ).map((tool) => tool.name),
  );
  for (const toolName of ['machine_diagnostics', 'file_read', 'file_write', 'shell_execute', 'machine_docker_action']) {
    assert.ok(withTarget.has(toolName), `${toolName} must remain available when a connection is selected`);
  }

  const noTargetContext = await contextService([]).compose({
    scope: availabilityScope,
    threadId: 'machine-availability-thread',
    runId: 'machine-availability-run',
    currentInput: 'Can I read a host file in this Run?',
    runScopeContext: [
      'Selected SSH connection IDs for this Run: none.',
      'Only the selected SSH connection IDs above are valid Machine execution targets for this Run.',
      'Historical Tool results from earlier Runs are evidence only; they do not grant or imply current target selection.',
    ].join('\n'),
    modelContextWindow: 8_192,
    maxContextTokens: 8_192,
    reservedOutputTokens: 512,
    maxRecallItems: 1,
    maxRecallBytes: 1_024,
    tools: [],
  });
  assert.ok(
    noTargetContext.messages.some(
      (message) =>
        message.role === 'system' &&
        message.content.includes('[Current Run execution scope; authoritative]') &&
        message.content.includes('Selected SSH connection IDs for this Run: none.') &&
        message.content.includes('Historical Tool results from earlier Runs are evidence only'),
    ),
    'the model context must carry authoritative current-Run target selection so historical Tool results cannot imply access',
  );
  assert.ok(noTargetContext.sourceRanges.some((source) => source.kind === 'run_scope'));
  assert.ok(noTargetContext.tokenDiagnostics.runScopeTokens > 0);

  const baseConnection = (id: number, host: string): Connection => ({
    id,
    name: `machine-${id}`,
    type: 'SSH',
    host,
    port: 22,
    username: 'deploy',
    authMethod: 'password',
    sshKeyId: null,
    proxyId: id === 1 ? 41 : null,
    route: id === 1 ? 'proxy' : null,
    tagIds: [],
    notes: null,
    jumpChain: null,
    rdpOptions: null,
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_100,
    lastConnectedAt: null,
  });
  const records = new Map<number, Connection>([
    [1, baseConnection(1, 'prod.example.test')],
    [2, baseConnection(2, 'unrelated.example.test')],
  ]);
  const dependencyFingerprints = new Map<number, string>([
    [1, 'route:proxy:v1'],
    [2, 'route:direct:v1'],
  ]);

  const connectionService = {
    list: async () => [...records.values()],
    get: async (id: number) => records.get(id) ?? null,
  } as unknown as ConnectionService;
  const sshResolverStub = {
    resolveStored: async () => {
      throw new Error('scenario does not open a transport');
    },
    fingerprintStored: async (id: number) =>
      `${records.get(id)?.updatedAt ?? 'missing'}:${dependencyFingerprints.get(id) ?? 'missing'}`,
  } as unknown as SshConnectionResolver;
  const resolver = createAgentConnectionResolver(connectionService, sshResolverStub);
  const deniedTargetIds = new Set<number>();
  const targetAdapter = new SshTargetAdapter(resolver, {
    isDenied: async (connectionId: number) => deniedTargetIds.has(connectionId),
  } as unknown as TargetDenylistRepositoryPort);
  const targetContext: ToolContext = {
    userId: 1,
    appId: 'machine-availability-app',
    runId: 'machine-availability-run',
    agentRuntimeId: 'machine-availability-runtime',
    connectionIds: [1],
    signal: new AbortController().signal,
    deadlineAt: Math.floor(Date.now() / 1000) + 60,
    maxOutputBytes: 64 * 1024,
  };
  const resolvedTarget = await targetAdapter.target(targetContext, 1);
  assert.equal(resolvedTarget.connectionId, 1);
  await assert.rejects(() => targetAdapter.target(targetContext, 2), /TARGET_NOT_SELECTED/);
  deniedTargetIds.add(1);
  await assert.rejects(() => targetAdapter.target(targetContext, 1), /TARGET_DENIED/);
  deniedTargetIds.clear();

  const approved = await resolver.get(1);
  assert.ok(approved);

  dependencyFingerprints.set(1, 'route:proxy:v2');
  const proxyChanged = await resolver.get(1);
  assert.ok(proxyChanged);
  assert.notEqual(
    proxyChanged.configurationHash,
    approved.configurationHash,
    'Proxy dependency revision changes must invalidate the approved Machine target fingerprint even when the parent Connection row is unchanged',
  );

  dependencyFingerprints.set(1, 'route:jump:v3');
  const jumpChanged = await resolver.get(1);
  assert.ok(jumpChanged);
  assert.notEqual(
    jumpChanged.configurationHash,
    proxyChanged.configurationHash,
    'Jump-chain dependency revision changes must invalidate the approved Machine target fingerprint',
  );

  const stable = await resolver.get(1);
  assert.ok(stable);
  assert.equal(
    stable.configurationHash,
    jumpChanged.configurationHash,
    'An unchanged Machine route dependency graph must keep the approval fingerprint stable',
  );

  dependencyFingerprints.set(2, 'route:direct:v2');
  const unrelatedChanged = await resolver.get(1);
  assert.ok(unrelatedChanged);
  assert.equal(
    unrelatedChanged.configurationHash,
    stable.configurationHash,
    'Updating an unrelated Connection must not invalidate this Machine approval fingerprint',
  );

  const direct = records.get(1)!;
  records.set(1, { ...direct, updatedAt: direct.updatedAt + 1 });
  const directChanged = await resolver.get(1);
  assert.ok(directChanged);
  assert.notEqual(
    directChanged.configurationHash,
    unrelatedChanged.configurationHash,
    'Direct Connection changes must continue invalidating the Machine target fingerprint',
  );

  const storedConnection = (
    id: number,
    host: string,
    overrides: Partial<StoredConnectionRecord> = {},
  ): StoredConnectionRecord => ({
    id,
    name: `stored-${id}`,
    type: 'SSH',
    host,
    port: 22,
    username: 'deploy',
    authMethod: 'password',
    sshKeyId: null,
    proxyId: null,
    route: null,
    notes: null,
    jumpChain: null,
    rdpOptions: null,
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_100,
    lastConnectedAt: null,
    encryptedPassword: `opaque-password-${id}-v1`,
    encryptedPrivateKey: null,
    encryptedPassphrase: null,
    ...overrides,
  });
  const storedConnections = new Map<number, StoredConnectionRecord>([
    [10, storedConnection(10, 'direct.example.test')],
    [11, storedConnection(11, 'proxy-target.example.test', { route: 'proxy', proxyId: 71 })],
    [12, storedConnection(12, 'jump-target.example.test', { route: 'jump', jumpChain: [13] })],
    [13, storedConnection(13, 'jump-hop.example.test')],
    [14, storedConnection(14, 'unrelated.example.test')],
    [
      15,
      storedConnection(15, 'keyed.example.test', {
        authMethod: 'key',
        sshKeyId: 91,
        encryptedPassword: null,
      }),
    ],
  ]);
  const proxies = new Map<number, StoredProxyRecord>([
    [
      71,
      {
        id: 71,
        name: 'route-proxy',
        type: 'SOCKS5',
        host: 'proxy.example.test',
        port: 1080,
        username: 'proxy-user',
        authMethod: 'password',
        encryptedPassword: 'opaque-proxy-password-v1',
        encryptedPrivateKey: null,
        encryptedPassphrase: null,
        createdAt: 1_700_000_000,
        updatedAt: 1_700_000_100,
      },
    ],
  ]);
  const sshKeys = new Map<number, StoredSshKeyRecord>([
    [
      91,
      {
        id: 91,
        name: 'route-key',
        encryptedPrivateKey: 'opaque-key-v1',
        encryptedPassphrase: 'opaque-passphrase-v1',
        createdAt: 1_700_000_000,
        updatedAt: 1_700_000_100,
      },
    ],
  ]);
  const cipher: SecretCipher = {
    encrypt: (value) => `opaque:${value}`,
    decrypt: (value) => (value.startsWith('opaque:') ? value.slice('opaque:'.length) : value),
  };
  const connectionRepository = {
    getStored: async (id: number) => storedConnections.get(id) ?? null,
  } as unknown as ConnectionRepository;
  const proxyRepository = {
    get: async (id: number) => proxies.get(id) ?? null,
  } as unknown as ProxyRepository;
  const sshKeyRepository = {
    get: async (id: number) => sshKeys.get(id) ?? null,
  } as unknown as SshKeyRepository;
  const keyService = new SshKeyService(sshKeyRepository, cipher);
  const credentialService = new ConnectionCredentialService(cipher, keyService);
  const proxyService = new ProxyService(proxyRepository, cipher);
  const realResolver = new SshConnectionResolver(connectionRepository, credentialService, proxyService);

  const directV1 = await realResolver.fingerprintStored(10);
  storedConnections.set(10, { ...storedConnections.get(10)!, encryptedPassword: 'opaque-password-10-v2' });
  const directCredentialV2 = await realResolver.fingerprintStored(10);
  assert.notEqual(
    directCredentialV2,
    directV1,
    'A direct Connection credential change must invalidate the fingerprint even when updatedAt stays in the same second',
  );

  const proxyV1 = await realResolver.fingerprintStored(11);
  proxies.set(71, { ...proxies.get(71)!, host: 'proxy-rotated.example.test' });
  const proxyHostV2 = await realResolver.fingerprintStored(11);
  assert.notEqual(proxyHostV2, proxyV1, 'Proxy host changes must invalidate the Machine route fingerprint');
  proxies.set(71, { ...proxies.get(71)!, encryptedPassword: 'opaque-proxy-password-v2' });
  const proxyCredentialV3 = await realResolver.fingerprintStored(11);
  assert.notEqual(
    proxyCredentialV3,
    proxyHostV2,
    'Proxy credential changes must invalidate the fingerprint even when updatedAt stays in the same second',
  );

  const jumpV1 = await realResolver.fingerprintStored(12);
  storedConnections.set(13, { ...storedConnections.get(13)!, host: 'jump-hop-rotated.example.test' });
  const jumpHostV2 = await realResolver.fingerprintStored(12);
  assert.notEqual(jumpHostV2, jumpV1, 'Any Jump hop host change must invalidate the Machine route fingerprint');
  storedConnections.set(13, {
    ...storedConnections.get(13)!,
    encryptedPassword: 'opaque-password-13-v2',
  });
  const jumpCredentialV3 = await realResolver.fingerprintStored(12);
  assert.notEqual(
    jumpCredentialV3,
    jumpHostV2,
    'Any Jump hop credential change must invalidate the fingerprint even when updatedAt stays in the same second',
  );

  const keyedV1 = await realResolver.fingerprintStored(15);
  sshKeys.set(91, { ...sshKeys.get(91)!, encryptedPrivateKey: 'opaque-key-v2' });
  const keyedV2 = await realResolver.fingerprintStored(15);
  assert.notEqual(
    keyedV2,
    keyedV1,
    'A referenced SSH key credential change must invalidate the parent Connection fingerprint',
  );

  const unchangedV1 = await realResolver.fingerprintStored(12);
  const unchangedV2 = await realResolver.fingerprintStored(12);
  assert.equal(unchangedV2, unchangedV1, 'An unchanged route graph must produce a stable fingerprint');

  const unaffectedBefore = await realResolver.fingerprintStored(12);
  storedConnections.set(14, {
    ...storedConnections.get(14)!,
    host: 'unrelated-rotated.example.test',
    encryptedPassword: 'opaque-password-14-v2',
  });
  const unaffectedAfter = await realResolver.fingerprintStored(12);
  assert.equal(
    unaffectedAfter,
    unaffectedBefore,
    'An unrelated Connection revision must not invalidate another Machine route fingerprint',
  );

  for (const fingerprint of [directCredentialV2, proxyCredentialV3, jumpCredentialV3, keyedV2]) {
    assert.match(fingerprint, /^[a-f0-9]{64}$/);
    assert.equal(fingerprint.includes('opaque-'), false, 'Machine fingerprints must never expose credential material');
  }

  const stablePinnedResolver = createAgentConnectionResolver(connectionService, realResolver);
  const stablePinnedHash = await realResolver.fingerprintStored(11);
  const stablePinnedConnection = await stablePinnedResolver.resolve(11, stablePinnedHash);
  assert.equal(stablePinnedConnection.host, 'proxy-target.example.test');

  let pinnedRevision = 'pinned-v1';
  const pinnedHash = createHash('sha256').update(pinnedRevision).digest('hex');
  const changingResolver = {
    fingerprintStored: async () => createHash('sha256').update(pinnedRevision).digest('hex'),
    resolveStored: async () => {
      pinnedRevision = 'pinned-v2';
      return {
        connectionId: 1,
        displayName: 'changing-target',
        host: 'prod.example.test',
        port: 22,
        username: 'deploy',
        authMethod: 'password',
        route: null,
      };
    },
  } as unknown as SshConnectionResolver;
  const changingPinnedResolver = createAgentConnectionResolver(connectionService, changingResolver);
  await assert.rejects(
    () => changingPinnedResolver.resolve(1, pinnedHash),
    /RESOURCE_CHANGED/,
    'A route dependency change during live resolution must be rejected before an SSH transport can be opened',
  );

  return [
    { name: 'machine_no_target_tools_exposed', value: 0, unit: 'tools' },
    { name: 'machine_run_scope_contexts', value: 1, unit: 'contexts' },
    { name: 'machine_direct_credential_stale_rejections', value: 1, unit: 'cases' },
    { name: 'machine_proxy_host_stale_rejections', value: 1, unit: 'cases' },
    { name: 'machine_proxy_credential_stale_rejections', value: 1, unit: 'cases' },
    { name: 'machine_jump_host_stale_rejections', value: 1, unit: 'cases' },
    { name: 'machine_jump_credential_stale_rejections', value: 1, unit: 'cases' },
    { name: 'machine_ssh_key_credential_stale_rejections', value: 1, unit: 'cases' },
    { name: 'machine_unrelated_connection_invalidations', value: 0, unit: 'cases' },
    { name: 'machine_unchanged_route_stability', value: 1, unit: 'cases' },
    { name: 'machine_plaintext_secret_fingerprint_leaks', value: 0, unit: 'cases' },
    { name: 'machine_pinned_resolve_midflight_stale_rejections', value: 1, unit: 'cases' },
  ];
};
