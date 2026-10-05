import type { JsonValue } from '../../agent.types';
import type { IntegrationRepositoryPort } from '../../ai/integration.repository.port';
import type { AcpIntegrationConfiguration, AcpRuntimePort, IntegrationView } from '../../ai/integrations.types';
import type {
  AgentTool,
  ToolContext,
  ToolInspection,
  ToolPrecondition,
  ToolResult,
} from '../../capabilities/tool.types';
import type { CryptoHashPort } from '../../crypto-hash.port';
import { hashOperation } from '../../operation-hash';
import type { AcpPermissionRequestPort } from '../../runtime/approvals/acp-permission-broker';
import { isAgentUuid } from '../../uuid';
import type { AgentWorkspaceRepositoryPort } from '../../workspace-runtime/workspace-runtime.repository.port';
import type { AgentTargetResolver } from '../../capabilities/target-resolver';
import type { AcpByteTransport } from '../../ai/integrations.types';

const MAX_PROMPT_BYTES = 32 * 1024;
const MAX_CWD_BYTES = 4096;

const object = (value: JsonValue): Record<string, JsonValue> => {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('TOOL_ARGUMENTS_INVALID');
  return value as Record<string, JsonValue>;
};

const string = (value: JsonValue | undefined, maxBytes: number): string => {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.includes('\0') ||
    Buffer.byteLength(value, 'utf8') > maxBytes
  ) {
    throw new Error('TOOL_ARGUMENTS_INVALID');
  }
  return value.trim();
};

const currentIntegration = async (
  repository: IntegrationRepositoryPort,
  context: ToolContext,
  integrationId: string,
): Promise<IntegrationView & { kind: 'acp'; configuration: AcpIntegrationConfiguration }> => {
  if (!isAgentUuid(integrationId)) throw new Error('TOOL_ARGUMENTS_INVALID');
  const integration = await repository.get(context, integrationId);
  if (!integration || integration.kind !== 'acp') throw new Error('INTEGRATION_NOT_FOUND');
  if (!integration.enabled) throw new Error('INTEGRATION_DISABLED');
  if (integration.configuration.transport !== 'workspace-profile' && integration.configuration.transport !== 'ssh')
    throw new Error('INTEGRATION_KIND_MISMATCH');
  return integration as IntegrationView & { kind: 'acp'; configuration: AcpIntegrationConfiguration };
};

export const createAcpExecuteTool = (
  integrations: IntegrationRepositoryPort,
  workspaces: AgentWorkspaceRepositoryPort,
  runtime: AcpRuntimePort,
  cryptoHash: CryptoHashPort,
  permissionRequests: AcpPermissionRequestPort,
  ssh?: {
    targets: AgentTargetResolver;
    open(
      context: ToolContext,
      connectionId: number,
      configurationHash: string,
      argv: string[],
      cwd: string,
    ): Promise<AcpByteTransport>;
  },
): AgentTool => ({
  descriptor: {
    name: 'acp_execute',
    version: '1.0.0',
    description:
      'Run one approved ACP prompt on Workspace or SSH using target/id and a matching configured integration. Workspace uses a frozen ACP profile; SSH starts configured argv in an independent non-PTY channel. Optional cwd selects the session directory. Neither is an OS sandbox; inner sensitive-operation permission requests go through Nexus approval independently. SSH disconnects are not replayed.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        integrationId: { type: 'string', minLength: 36, maxLength: 36 },
        workspaceId: { type: 'string', minLength: 1, maxLength: 128 },
        target: { type: 'string', enum: ['workspace', 'ssh'] },
        id: { type: 'string', minLength: 1, maxLength: 128 },
        prompt: { type: 'string', minLength: 1, maxLength: MAX_PROMPT_BYTES },
        cwd: { type: 'string', minLength: 1, maxLength: MAX_CWD_BYTES },
      },
      required: ['integrationId', 'prompt'],
    },
    riskClass: 'mutate',
    capability: 'integration.acp.invoke',
  },
  isAvailable: ({ environment, connectionIds }) => environment !== null || (connectionIds?.length ?? 0) > 0,
  inspect: async (input, context, policyRevision): Promise<ToolInspection> => {
    const args = object(input);
    const integrationId = string(args.integrationId, 64);
    const configured = await currentIntegration(integrations, context, integrationId);
    if (configured.configuration.transport === 'ssh') {
      if (!ssh) throw new Error('ACP_SSH_TRANSPORT_NOT_CONFIGURED');
      if (args.target !== 'ssh' || args.workspaceId !== undefined) throw new Error('ACP_TARGET_CONFIGURATION_MISMATCH');
      const id = string(args.id, 128);
      const binding = await ssh.targets.resolve(context, { target: 'ssh', id });
      const cwd = args.cwd === undefined ? configured.configuration.cwd! : string(args.cwd, MAX_CWD_BYTES);
      if (!cwd.startsWith('/')) throw new Error('ACP_SSH_CWD_INVALID');
      const normalizedArguments: JsonValue = {
        integrationId,
        integrationVersion: configured.version,
        target: 'ssh',
        id,
        cwd,
        prompt: string(args.prompt, MAX_PROMPT_BYTES),
      };
      const configurationHash = hashOperation(
        {
          integration: configured.configuration as unknown as JsonValue,
          version: configured.version,
          connectionHash: binding.fingerprint.configurationHash,
        },
        cryptoHash,
      );
      const target: ToolInspection['target'] = {
        ...binding.fingerprint,
        configurationHash: binding.fingerprint.configurationHash,
        integrationId,
      };
      return {
        toolName: 'acp_execute',
        toolVersion: '1.0.0',
        normalizedArguments,
        target,
        resourceKeys: [...binding.resourceKeys, `integration:acp:${integrationId}`],
        risk: 'mutate',
        mutation: true,
        operationHash: hashOperation(
          {
            arguments: normalizedArguments,
            configurationHash,
            runId: context.runId,
            runtimeId: context.agentRuntimeId,
            policyRevision,
            inputRevision: context.inputRevision,
          },
          cryptoHash,
        ),
        operationHashVersion: 1,
        preconditions: [
          ...binding.preconditions,
          { kind: 'metadata', key: `integration:${integrationId}:version`, observedValue: configured.version },
        ],
        policyRevision,
        inputRevision: context.inputRevision,
      };
    }
    if (args.target !== undefined && args.target !== 'workspace') throw new Error('ACP_TARGET_CONFIGURATION_MISMATCH');
    if (args.workspaceId !== undefined && args.id !== undefined && args.workspaceId !== args.id)
      throw new Error('ACP_TARGET_ID_CONFLICT');
    const workspaceId = string(args.workspaceId ?? args.id, 128);
    const prompt = string(args.prompt, MAX_PROMPT_BYTES);
    const cwd = args.cwd === undefined ? '/workspace/work' : string(args.cwd, MAX_CWD_BYTES);
    if (cwd !== '/workspace' && !cwd.startsWith('/workspace/'))
      throw new Error('ACP_CWD_OUTSIDE_WORKSPACE', {
        cause: new Error(
          'ACP cwd must be /workspace or a path beneath it, for the configured Runner profile. No ACP process was started.',
        ),
      });

    const [integration, workspace] = await Promise.all([
      currentIntegration(integrations, context, integrationId),
      workspaces.getWorkspace(context, workspaceId),
    ]);
    if (!workspace) throw new Error('NOT_FOUND');
    if (workspace.runId !== context.runId || workspace.agentRuntimeId !== context.agentRuntimeId) {
      throw new Error('RESOURCE_FORBIDDEN');
    }
    if (workspace.status !== 'running') throw new Error('WORKSPACE_NOT_RUNNING');
    const profileId = integration.configuration.profileId;
    const profile = workspace.profile.acpProfiles.find((candidate) => candidate.id === profileId);
    if (!profile) throw new Error('ACP_PROFILE_NOT_FOUND');

    const configurationHash = hashOperation(
      {
        schemaVersion: 1,
        integrationId,
        integrationVersion: integration.version,
        profile: {
          id: profile.id,
          profileRevision: profile.profileRevision,
          argv: [...profile.argv],
          cwd: profile.cwd,
        },
        workspaceId,
        generation: workspace.generation,
      },
      cryptoHash,
    );
    const normalizedArguments: JsonValue = {
      integrationId,
      integrationVersion: integration.version,
      workspaceId,
      generation: workspace.generation,
      profileId,
      profileRevision: profile.profileRevision,
      prompt,
      cwd,
    };
    const resourceKeys = [`integration:acp:${integrationId}`, `workspace:${workspaceId}:${workspace.generation}`];
    const preconditions: ToolPrecondition[] = [
      { kind: 'metadata', key: `integration:${integrationId}:version`, observedValue: integration.version },
      {
        kind: 'workspaceGeneration',
        key: workspaceId,
        observedValue: { generation: workspace.generation, version: workspace.version, status: workspace.status },
      },
    ];
    const target: ToolInspection['target'] = {
      kind: 'integration',
      integrationId,
      workspaceId,
      generation: workspace.generation,
      targetIdentity: `acp:${integrationId}:${workspaceId}:${workspace.generation}:${profileId}`,
      endpoint: `workspace-acp:${workspaceId}:${profileId}`,
      loginUser: 'runner:acp',
      configurationHash,
    };
    const operationHash = hashOperation(
      {
        schemaVersion: 1,
        scope: {
          userId: context.userId,
          appId: context.appId,
          runId: context.runId,
          agentRuntimeId: context.agentRuntimeId,
        },
        tool: { name: 'acp_execute', version: '1.0.0' },
        target: {
          kind: target.kind,
          integrationId: target.integrationId ?? null,
          workspaceId: target.workspaceId ?? null,
          generation: target.generation ?? null,
          targetIdentity: target.targetIdentity,
          endpoint: target.endpoint,
          loginUser: target.loginUser,
          configurationHash: target.configurationHash,
        },
        arguments: normalizedArguments,
        resourceKeys: [...resourceKeys].sort(),
        preconditions: preconditions.map((item) => ({
          kind: item.kind,
          key: item.key,
          observedValue: item.observedValue,
        })),
        policyRevision,
        inputRevision: context.inputRevision,
      },
      cryptoHash,
    );
    return {
      toolName: 'acp_execute',
      toolVersion: '1.0.0',
      normalizedArguments,
      target,
      resourceKeys,
      risk: 'mutate',
      mutation: true,
      operationHash,
      operationHashVersion: 1,
      preconditions,
      policyRevision,
      inputRevision: context.inputRevision,
    };
  },
  execute: async (inspection, context): Promise<ToolResult> => {
    const args = object(inspection.normalizedArguments);
    const integrationId = string(args.integrationId, 64);
    if (args.target === 'ssh') {
      if (!ssh) throw new Error('ACP_SSH_TRANSPORT_NOT_CONFIGURED');
      const integration = await currentIntegration(integrations, context, integrationId);
      if (integration.version !== Number(args.integrationVersion) || integration.configuration.transport !== 'ssh')
        throw new Error('RESOURCE_CHANGED');
      const binding = await ssh.targets.resolve(context, { target: 'ssh', id: string(args.id, 128) });
      if (binding.fingerprint.configurationHash !== inspection.target.configurationHash)
        throw new Error('RESOURCE_CHANGED');
      const cwd = string(args.cwd, MAX_CWD_BYTES);
      const result = await runtime.execute(
        integration,
        {
          workspaceId: '',
          generation: 0,
          cwd,
          prompt: string(args.prompt, MAX_PROMPT_BYTES),
          maxOutputBytes: context.maxOutputBytes,
        },
        {
          signal: context.signal,
          openTransport: () =>
            ssh.open(
              context,
              binding.connectionId!,
              binding.fingerprint.configurationHash,
              integration.configuration.argv!,
              cwd,
            ),
          requestPermission: (request) => permissionRequests.request(context, inspection, request),
        },
      );
      return {
        ok: true,
        summary: `ACP execution completed (${result.stopReason}).`,
        data: { text: result.text, stopReason: result.stopReason },
        artifactRefs: [],
        truncated: false,
        outcome: 'confirmed',
        verification: {
          status: 'unverified',
          summary: 'ACP protocol completed; output is not independent verification of external facts.',
          evidenceRefs: [],
        },
      };
    }
    const workspaceId = string(args.workspaceId, 128);
    const generation = Number(args.generation);
    const expectedIntegrationVersion = Number(args.integrationVersion);
    const profileId = string(args.profileId, 128);
    const [integration, workspace] = await Promise.all([
      currentIntegration(integrations, context, integrationId),
      workspaces.getWorkspace(context, workspaceId),
    ]);
    if (
      !workspace ||
      workspace.status !== 'running' ||
      workspace.generation !== generation ||
      workspace.runId !== context.runId ||
      workspace.agentRuntimeId !== context.agentRuntimeId ||
      integration.version !== expectedIntegrationVersion ||
      integration.configuration.profileId !== profileId ||
      !workspace.profile.acpProfiles.some(
        (candidate) => candidate.id === profileId && candidate.profileRevision === Number(args.profileRevision),
      )
    ) {
      throw new Error('RESOURCE_CHANGED');
    }
    const result = await runtime.execute(
      integration,
      {
        workspaceId,
        generation,
        cwd: string(args.cwd, MAX_CWD_BYTES),
        prompt: string(args.prompt, MAX_PROMPT_BYTES),
        maxOutputBytes: context.maxOutputBytes,
      },
      {
        signal: context.signal,
        // The outer acp_execute approval never authorizes an inner action selected later by the
        // remote agent. Each inner permission request is bound to the still-running parent Tool
        // and goes through the existing durable Approval owner.
        requestPermission: (request) => permissionRequests.request(context, inspection, request),
      },
    );
    return {
      ok: true,
      summary: `ACP execution completed (${result.stopReason}).`,
      userSummary: {
        key: 'agent.conversation.toolSummary.acpCompleted',
        params: { reasonKey: `agent.conversation.toolSummary.labels.acpStopReason.${result.stopReason}` },
      },
      data: { text: result.text, stopReason: result.stopReason },
      artifactRefs: [],
      truncated: false,
      outcome: 'confirmed',
      verification: {
        status: 'unverified',
        summary:
          'The isolated ACP protocol completed successfully; ACP output is not independent verification of external facts.',
        evidenceRefs: [],
      },
    };
  },
});
