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
import { isAgentUuid } from '../../uuid';
import type { AgentWorkspaceRepositoryPort } from '../../workspace-runtime/workspace-runtime.repository.port';

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
  if (integration.configuration.transport !== 'workspace-profile') throw new Error('INTEGRATION_KIND_MISMATCH');
  return integration as IntegrationView & { kind: 'acp'; configuration: AcpIntegrationConfiguration };
};

export const createAcpExecuteTool = (
  integrations: IntegrationRepositoryPort,
  workspaces: AgentWorkspaceRepositoryPort,
  runtime: AcpRuntimePort,
  cryptoHash: CryptoHashPort,
): AgentTool => ({
  descriptor: {
    name: 'acp_execute',
    version: '1.0.0',
    description:
      'Run one approved ACP prompt through an ACP backend frozen into an already-running Workspace generation. ACP runs as a native Runner child process in the single-user trust model, so Nexus does not claim per-process read-only filesystem or network sandboxing; ACP-side sensitive-operation permission requests still fail closed at the Nexus protocol boundary.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        integrationId: { type: 'string', minLength: 36, maxLength: 36 },
        workspaceId: { type: 'string', minLength: 1, maxLength: 128 },
        prompt: { type: 'string', minLength: 1, maxLength: MAX_PROMPT_BYTES },
        cwd: { type: 'string', minLength: 1, maxLength: MAX_CWD_BYTES },
      },
      required: ['integrationId', 'workspaceId', 'prompt'],
    },
    riskClass: 'mutate',
    capability: 'integration.acp.execute',
  },
  inspect: async (input, context, policyRevision): Promise<ToolInspection> => {
    const args = object(input);
    const integrationId = string(args.integrationId, 64);
    const workspaceId = string(args.workspaceId, 128);
    const prompt = string(args.prompt, MAX_PROMPT_BYTES);
    const cwd = args.cwd === undefined ? '/workspace/work' : string(args.cwd, MAX_CWD_BYTES);
    if (cwd !== '/workspace' && !cwd.startsWith('/workspace/')) throw new Error('TOOL_ARGUMENTS_INVALID');

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
      secretRefs: [],
      policyRevision,
      inputRevision: context.inputRevision,
    };
  },
  execute: async (inspection, context): Promise<ToolResult> => {
    const args = object(inspection.normalizedArguments);
    const integrationId = string(args.integrationId, 64);
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
        // ACP ToolKind is a presentation hint, not an authorization primitive. Until Nexus has a
        // nested Approval broker for ACP permission requests, never let an outer acp_execute
        // approval silently authorize a second sensitive operation chosen by the remote agent.
        requestPermission: async () => 'reject_once',
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
        summary:
          'The isolated ACP protocol completed successfully; ACP output is not independent verification of external facts.',
        evidenceRefs: [],
      },
    };
  },
});
