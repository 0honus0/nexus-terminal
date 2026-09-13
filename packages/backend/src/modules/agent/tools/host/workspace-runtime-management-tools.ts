import type { JsonValue } from '../../agent.types';
import type { CryptoHashPort } from '../../crypto-hash.port';
import { hashOperation } from '../../operation-hash';
import type {
  AgentTool,
  ToolContext,
  ToolInspection,
  ToolPrecondition,
  ToolResult,
} from '../../capabilities/tool.types';
import type { AgentWorkspaceRepositoryPort } from '../../workspace-runtime/workspace-runtime.repository.port';
import {
  resolveWorkspaceToolchain,
  type WorkspaceRuntimeService,
} from '../../workspace-runtime/workspace-runtime.service';

const record = (value: JsonValue): Record<string, JsonValue> => {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('TOOL_ARGUMENTS_INVALID');
  return value as Record<string, JsonValue>;
};
const onlyKeys = (value: Record<string, JsonValue>, allowed: readonly string[]): void => {
  const keys = new Set(allowed);
  if (Object.keys(value).some((key) => !keys.has(key))) throw new Error('TOOL_ARGUMENTS_INVALID');
};
const stringValue = (value: JsonValue | undefined, maxBytes: number): string => {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new Error('TOOL_ARGUMENTS_INVALID');
  }
  return value;
};
const positiveInteger = (value: JsonValue | undefined): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error('TOOL_ARGUMENTS_INVALID');
  return value as number;
};
const versionsValue = (value: JsonValue | undefined): Record<string, string> => {
  if (value === undefined) return {};
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('TOOL_ARGUMENTS_INVALID');
  const entries = Object.entries(value);
  if (entries.length > 32) throw new Error('TOOL_ARGUMENTS_INVALID');
  const result: Record<string, string> = {};
  for (const [familyId, versionId] of entries) {
    if (!familyId || familyId.length > 128 || typeof versionId !== 'string' || !versionId || versionId.length > 128) {
      throw new Error('TOOL_ARGUMENTS_INVALID');
    }
    result[familyId] = versionId;
  }
  return result;
};
const runnerPluginIdsValue = (value: JsonValue | undefined): string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 32) throw new Error('TOOL_ARGUMENTS_INVALID');
  const ids = value.map((pluginId) => {
    if (
      typeof pluginId !== 'string' ||
      !/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/.test(pluginId) ||
      Buffer.byteLength(pluginId, 'utf8') > 128
    ) {
      throw new Error('TOOL_ARGUMENTS_INVALID');
    }
    return pluginId;
  });
  if (new Set(ids).size !== ids.length) throw new Error('TOOL_ARGUMENTS_INVALID');
  return ids;
};

const workspaceTarget = (
  cryptoHash: CryptoHashPort,
  input: {
    workspaceId?: string;
    generation?: number;
    runId: string;
    agentRuntimeId: string;
    configuration: JsonValue;
  },
): ToolInspection['target'] => {
  const identity = input.workspaceId
    ? `workspace:${input.workspaceId}:${input.generation ?? 0}`
    : `workspace:new:${input.runId}:${input.agentRuntimeId}`;
  return {
    kind: 'workspace',
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    ...(input.generation ? { generation: input.generation } : {}),
    targetIdentity: identity,
    endpoint: input.workspaceId ? `workspace:${input.workspaceId}` : 'workspace:new',
    loginUser: 'runner:65532',
    configurationHash: hashOperation(input.configuration, cryptoHash),
  };
};

const operation = (
  cryptoHash: CryptoHashPort,
  context: ToolContext,
  toolName: string,
  target: ToolInspection['target'],
  normalizedArguments: JsonValue,
  resourceKeys: string[],
  preconditions: ToolPrecondition[],
  policyRevision: number,
): string =>
  hashOperation(
    {
      schemaVersion: 2,
      scope: {
        userId: context.userId,
        appId: context.appId,
        runId: context.runId,
        agentRuntimeId: context.agentRuntimeId,
      },
      tool: { name: toolName, version: '1.0.0' },
      target: {
        kind: target.kind,
        targetIdentity: target.targetIdentity,
        endpoint: target.endpoint,
        configurationHash: target.configurationHash,
        workspaceId: target.workspaceId ?? null,
        generation: target.generation ?? null,
      },
      arguments: normalizedArguments,
      resourceKeys: [...resourceKeys].sort(),
      preconditions: preconditions.map((item) => ({
        kind: item.kind,
        key: item.key,
        observedValue: item.observedValue,
      })),
      secretRefs: [],
      policyRevision,
      inputRevision: context.inputRevision,
    },
    cryptoHash,
  );

export const createWorkspaceCreateTool = (
  runtime: WorkspaceRuntimeService,
  repository: AgentWorkspaceRepositoryPort,
  cryptoHash: CryptoHashPort,
): AgentTool => ({
  descriptor: {
    name: 'workspace_create',
    version: '2.0.0',
    description:
      'Provision one Nexus Agent Workspace for this Run using the server-validated Environment frozen into the Run definition. Requires user approval.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
    riskClass: 'mutate',
    capability: 'workspace.runtime.manage',
  },
  inspect: async (input, context, policyRevision) => {
    const args = record(input);
    onlyKeys(args, []);
    const environment = context.environment;
    if (!environment) throw new Error('RUN_ENVIRONMENT_NOT_CONFIGURED');
    const existing = await repository.listWorkspaces(context, context.runId);
    if (
      existing.some(
        (workspace) =>
          workspace.agentRuntimeId === context.agentRuntimeId && !['deleted', 'failed'].includes(workspace.status),
      )
    ) {
      throw new Error('WORKSPACE_EXISTS');
    }
    const normalizedArguments: JsonValue = {
      recipeId: environment.recipeId,
      recipeRevision: environment.recipeRevision,
      runtimeDigest: environment.runtimeDigest,
      catalogRevision: environment.catalogRevision,
    };
    const target = workspaceTarget(cryptoHash, {
      runId: context.runId,
      agentRuntimeId: context.agentRuntimeId,
      configuration: {
        schemaVersion: 3,
        catalogRevision: environment.catalogRevision,
        runtimeDigest: environment.runtimeDigest,
        recipeId: environment.recipeId,
        recipeRevision: environment.recipeRevision,
      },
    });
    const resourceKeys = [`workspace:new:${context.runId}:${context.agentRuntimeId}`];
    const preconditions: ToolPrecondition[] = [
      {
        kind: 'metadata',
        key: 'runEnvironment',
        observedValue: {
          catalogRevision: environment.catalogRevision,
          recipeRevision: environment.recipeRevision,
          runtimeDigest: environment.runtimeDigest,
        },
      },
    ];
    return {
      toolName: 'workspace_create',
      toolVersion: '1.0.0',
      normalizedArguments,
      target,
      resourceKeys,
      risk: 'mutate',
      mutation: true,
      operationHash: operation(
        cryptoHash,
        context,
        'workspace_create',
        target,
        normalizedArguments,
        resourceKeys,
        preconditions,
        policyRevision,
      ),
      operationHashVersion: 1,
      preconditions,
      secretRefs: [],
      policyRevision,
      inputRevision: context.inputRevision,
    };
  },
  execute: async (inspection, context): Promise<ToolResult> => {
    const environment = context.environment;
    if (!environment) throw new Error('RUN_ENVIRONMENT_NOT_CONFIGURED');
    const workspace = await runtime.createWorkspace(
      context,
      context.runId,
      context.agentRuntimeId,
      null,
      false,
      inspection.operationHash,
      environment.catalogRevision,
      environment,
    );
    const ready = workspace.status === 'ready';
    return {
      ok: ready,
      summary: ready ? 'Workspace provisioned and ready.' : `Workspace is ${workspace.status}.`,
      data: {
        workspaceId: workspace.id,
        status: workspace.status,
        generation: workspace.generation,
        recipeId: workspace.profile.recipeId,
      },
      artifactRefs: [],
      truncated: false,
      outcome: 'confirmed',
      verification: {
        status: ready ? 'verified' : 'failed',
        summary: ready
          ? 'Runner confirmed provisioning and the Workspace is ready to start.'
          : 'Runner returned a terminal provisioning result that was not ready.',
        evidenceRefs: [],
      },
    };
  },
});

export const createWorkspaceControlTool = (
  runtime: WorkspaceRuntimeService,
  repository: AgentWorkspaceRepositoryPort,
  cryptoHash: CryptoHashPort,
): AgentTool => ({
  descriptor: {
    name: 'workspace_control',
    version: '1.0.0',
    description: 'Start, stop, restart, or delete one Nexus Agent Workspace generation. Requires user approval.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        workspaceId: { type: 'string', minLength: 1, maxLength: 128 },
        action: { type: 'string', enum: ['start', 'stop', 'restart', 'delete'] },
      },
      required: ['workspaceId', 'action'],
    },
    riskClass: 'mutate',
    capability: 'workspace.runtime.manage',
  },
  inspect: async (input, context, policyRevision) => {
    const args = record(input);
    onlyKeys(args, ['workspaceId', 'action']);
    const workspaceId = stringValue(args.workspaceId, 128);
    const action = stringValue(args.action, 32);
    if (!['start', 'stop', 'restart', 'delete'].includes(action)) throw new Error('TOOL_ARGUMENTS_INVALID');
    const workspace = await repository.getWorkspace(context, workspaceId);
    if (!workspace) throw new Error('NOT_FOUND');
    if (workspace.runId !== context.runId || workspace.agentRuntimeId !== context.agentRuntimeId) {
      throw new Error('RESOURCE_FORBIDDEN');
    }
    const normalizedArguments: JsonValue = {
      workspaceId,
      action,
      expectedVersion: workspace.version,
      generation: workspace.generation,
    };
    const target = workspaceTarget(cryptoHash, {
      workspaceId,
      generation: workspace.generation,
      runId: context.runId,
      agentRuntimeId: context.agentRuntimeId,
      configuration: {
        schemaVersion: 2,
        workspaceId,
        generation: workspace.generation,
        version: workspace.version,
        status: workspace.status,
        profile: JSON.parse(JSON.stringify(workspace.profile)) as JsonValue,
      },
    });
    const resourceKeys = [`workspace:${workspaceId}:${workspace.generation}`];
    const preconditions: ToolPrecondition[] = [
      {
        kind: 'workspaceGeneration',
        key: workspaceId,
        observedValue: { generation: workspace.generation, version: workspace.version, status: workspace.status },
      },
    ];
    return {
      toolName: 'workspace_control',
      toolVersion: '1.0.0',
      normalizedArguments,
      target,
      resourceKeys,
      risk: 'mutate',
      mutation: true,
      operationHash: operation(
        cryptoHash,
        context,
        'workspace_control',
        target,
        normalizedArguments,
        resourceKeys,
        preconditions,
        policyRevision,
      ),
      operationHashVersion: 1,
      preconditions,
      secretRefs: [],
      policyRevision,
      inputRevision: context.inputRevision,
    };
  },
  execute: async (inspection, context): Promise<ToolResult> => {
    const args = record(inspection.normalizedArguments);
    const workspaceId = stringValue(args.workspaceId, 128);
    const action = stringValue(args.action, 32) as 'start' | 'stop' | 'restart' | 'delete';
    const command = await runtime.action(context, workspaceId, action, positiveInteger(args.expectedVersion));
    const confirmed = command.status === 'succeeded' || command.status === 'failed';
    return {
      ok: command.status === 'succeeded',
      summary:
        command.status === 'succeeded' ? `Workspace ${action} confirmed.` : `Workspace ${action} is ${command.status}.`,
      data: { workspaceId, generation: command.generation, commandId: command.id, status: command.status },
      artifactRefs: [],
      truncated: false,
      outcome: confirmed ? 'confirmed' : 'unknown',
      ...(command.status === 'succeeded' ? {} : { errorCode: `WORKSPACE_${command.status.toUpperCase()}` }),
      verification: {
        status: command.status === 'succeeded' ? 'verified' : confirmed ? 'failed' : 'unverified',
        summary:
          command.status === 'succeeded'
            ? 'Runner confirmed the Workspace lifecycle transition.'
            : 'Runner did not confirm a successful Workspace lifecycle transition.',
        evidenceRefs: [],
      },
    };
  },
});

export const createWorkspaceSwitchToolVersionsTool = (
  runtime: WorkspaceRuntimeService,
  repository: AgentWorkspaceRepositoryPort,
  cryptoHash: CryptoHashPort,
): AgentTool => ({
  descriptor: {
    name: 'workspace_switch_tool_versions',
    version: '1.0.0',
    description:
      'Switch one or more tool versions for a stable Nexus Agent Workspace by creating its next generation. Requires user approval.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        workspaceId: { type: 'string', minLength: 1, maxLength: 128 },
        versions: {
          type: 'object',
          minProperties: 1,
          maxProperties: 32,
          additionalProperties: { type: 'string', minLength: 1, maxLength: 128 },
        },
      },
      required: ['workspaceId', 'versions'],
    },
    riskClass: 'mutate',
    capability: 'workspace.runtime.manage',
  },
  inspect: async (input, context, policyRevision) => {
    const args = record(input);
    onlyKeys(args, ['workspaceId', 'versions']);
    const workspaceId = stringValue(args.workspaceId, 128);
    const versions = versionsValue(args.versions);
    if (!Object.keys(versions).length) throw new Error('TOOL_ARGUMENTS_INVALID');
    const workspace = await repository.getWorkspace(context, workspaceId);
    if (!workspace) throw new Error('NOT_FOUND');
    if (workspace.runId !== context.runId || workspace.agentRuntimeId !== context.agentRuntimeId) {
      throw new Error('RESOURCE_FORBIDDEN');
    }
    if (!['ready', 'running', 'stopped'].includes(workspace.status)) throw new Error('WORKSPACE_STATE_INVALID');
    const catalog = await runtime.catalog(context.signal);
    const currentVersions = Object.fromEntries(
      workspace.profile.toolchain.map((pack) => [pack.familyId, pack.versionId]),
    ) as Record<string, string>;
    resolveWorkspaceToolchain(catalog, workspace.profile.recipeId, { ...currentVersions, ...versions });
    const normalizedArguments: JsonValue = {
      workspaceId,
      versions,
      expectedVersion: workspace.version,
      generation: workspace.generation,
      catalogRevision: catalog.revision,
    };
    const target = workspaceTarget(cryptoHash, {
      workspaceId,
      generation: workspace.generation,
      runId: context.runId,
      agentRuntimeId: context.agentRuntimeId,
      configuration: {
        schemaVersion: 2,
        workspaceId,
        generation: workspace.generation,
        currentProfile: JSON.parse(JSON.stringify(workspace.profile)) as JsonValue,
        requestedVersions: versions,
        catalogRevision: catalog.revision,
      },
    });
    const resourceKeys = [`workspace:${workspaceId}:${workspace.generation}`];
    const preconditions: ToolPrecondition[] = [
      {
        kind: 'workspaceGeneration',
        key: workspaceId,
        observedValue: { generation: workspace.generation, version: workspace.version, status: workspace.status },
      },
      { kind: 'metadata', key: 'workspaceRuntimeCatalog', observedValue: { revision: catalog.revision } },
    ];
    return {
      toolName: 'workspace_switch_tool_versions',
      toolVersion: '1.0.0',
      normalizedArguments,
      target,
      resourceKeys,
      risk: 'mutate',
      mutation: true,
      operationHash: operation(
        cryptoHash,
        context,
        'workspace_switch_tool_versions',
        target,
        normalizedArguments,
        resourceKeys,
        preconditions,
        policyRevision,
      ),
      operationHashVersion: 1,
      preconditions,
      secretRefs: [],
      policyRevision,
      inputRevision: context.inputRevision,
    };
  },
  execute: async (inspection, context): Promise<ToolResult> => {
    const args = record(inspection.normalizedArguments);
    const workspaceId = stringValue(args.workspaceId, 128);
    const switched = await runtime.switchToolVersions(
      context,
      workspaceId,
      versionsValue(args.versions),
      positiveInteger(args.expectedVersion),
      stringValue(args.catalogRevision, 128),
    );
    return {
      ok: switched.outcome === 'succeeded',
      summary:
        switched.outcome === 'succeeded'
          ? `Workspace tool versions switched; generation is now ${switched.workspace.generation}.`
          : `Workspace tool version switch is ${switched.outcome}.`,
      data: {
        workspaceId,
        generation: switched.workspace.generation,
        status: switched.workspace.status,
        toolchain: switched.workspace.profile.toolchain.map((pack) => ({ ...pack })),
        commandIds: switched.commands.map((command) => command.id),
      },
      artifactRefs: [],
      truncated: false,
      outcome: switched.outcome === 'unknown' ? 'unknown' : 'confirmed',
      ...(switched.outcome === 'succeeded'
        ? {}
        : { errorCode: `WORKSPACE_TOOLCHAIN_SWITCH_${switched.outcome.toUpperCase()}` }),
      verification: {
        status: switched.outcome === 'succeeded' ? 'verified' : switched.outcome === 'failed' ? 'failed' : 'unverified',
        summary:
          switched.outcome === 'succeeded'
            ? 'Runner confirmed provisioning of the next Workspace generation with the requested toolchain.'
            : 'Runner did not confirm a successful Workspace toolchain switch.',
        evidenceRefs: [],
      },
    };
  },
});
