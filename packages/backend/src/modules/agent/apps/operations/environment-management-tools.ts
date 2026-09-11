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
import type { EnvironmentRepositoryPort } from '../../environments/environment.repository.port';
import type { EnvironmentService } from '../../environments/environment.service';

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

const environmentTarget = (
  cryptoHash: CryptoHashPort,
  input: {
    environmentId?: string;
    generation?: number;
    runId: string;
    agentRuntimeId: string;
    configuration: JsonValue;
  },
): ToolInspection['target'] => {
  const identity = input.environmentId
    ? `environment:${input.environmentId}:${input.generation ?? 0}`
    : `environment-group:${input.runId}:${input.agentRuntimeId}`;
  return {
    kind: 'environment',
    ...(input.environmentId ? { environmentId: input.environmentId } : {}),
    ...(input.generation ? { generation: input.generation } : {}),
    targetIdentity: identity,
    endpoint: input.environmentId ? `environment:${input.environmentId}` : 'environment:new',
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
      schemaVersion: 1,
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
        environmentId: target.environmentId ?? null,
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

export const createEnvironmentCreateTool = (
  environments: EnvironmentService,
  repository: EnvironmentRepositoryPort,
  cryptoHash: CryptoHashPort,
): AgentTool => ({
  descriptor: {
    name: 'environment_create',
    version: '1.0.0',
    description:
      'Provision one isolated Nexus Agent Environment for this Run using an enabled Environment recipe. Requires user approval.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        recipeId: { type: 'string', minLength: 1, maxLength: 128 },
        versions: {
          type: 'object',
          maxProperties: 32,
          additionalProperties: { type: 'string', minLength: 1, maxLength: 128 },
        },
        runnerPluginIds: {
          type: 'array',
          maxItems: 32,
          uniqueItems: true,
          items: {
            type: 'string',
            minLength: 3,
            maxLength: 128,
            pattern: '^[a-z][a-z0-9]*(?:\\.[a-z][a-z0-9-]*)+$',
          },
        },
      },
      required: ['recipeId'],
    },
    riskClass: 'mutate',
    capability: 'environment.manage',
  },
  inspect: async (input, context, policyRevision) => {
    const args = record(input);
    onlyKeys(args, ['recipeId', 'versions', 'runnerPluginIds', 'catalogRevision']);
    const recipeId = stringValue(args.recipeId, 128);
    const versions = versionsValue(args.versions);
    const runnerPluginIds = runnerPluginIdsValue(args.runnerPluginIds);
    const existing = await repository.listGroups(context, context.runId);
    if (existing.some((group) => group.agentRuntimeId === context.agentRuntimeId && group.status !== 'deleted')) {
      throw new Error('ENVIRONMENT_GROUP_EXISTS');
    }
    const catalog = await environments.catalog(context.signal);
    const recipe = catalog.recipes.find((candidate) => candidate.id === recipeId);
    if (!recipe) throw new Error('ENVIRONMENT_RECIPE_NOT_FOUND');
    for (const [familyId, versionId] of Object.entries(versions)) {
      if (!recipe.allowedFamilies.includes(familyId)) throw new Error('ENVIRONMENT_PACK_FORBIDDEN');
      if (
        !catalog.packs.some(
          (pack) => pack.familyId === familyId && pack.versionId === versionId && pack.status !== 'unavailable',
        )
      ) {
        throw new Error('ENVIRONMENT_PACK_UNAVAILABLE');
      }
    }
    const normalizedArguments: JsonValue = { recipeId, versions, runnerPluginIds, catalogRevision: catalog.revision };
    const target = environmentTarget(cryptoHash, {
      runId: context.runId,
      agentRuntimeId: context.agentRuntimeId,
      configuration: {
        schemaVersion: 1,
        catalogRevision: catalog.revision,
        runtimeDigest: catalog.runtimeDigest,
        recipeId: recipe.id,
        recipeRevision: recipe.revision,
      },
    });
    const resourceKeys = [`environment-group:${context.runId}:${context.agentRuntimeId}`];
    const preconditions: ToolPrecondition[] = [
      { kind: 'metadata', key: 'environmentCatalog', observedValue: { revision: catalog.revision } },
    ];
    return {
      toolName: 'environment_create',
      toolVersion: '1.0.0',
      normalizedArguments,
      target,
      resourceKeys,
      risk: 'mutate',
      mutation: true,
      operationHash: operation(
        cryptoHash,
        context,
        'environment_create',
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
    const group = await environments.createGroup(
      context,
      context.runId,
      context.agentRuntimeId,
      [
        {
          recipeId: stringValue(args.recipeId, 128),
          versions: versionsValue(args.versions),
          runnerPluginIds: runnerPluginIdsValue(args.runnerPluginIds),
        },
      ],
      false,
      inspection.operationHash,
      stringValue(args.catalogRevision, 128),
    );
    const ready = group.environments.every((environment) => environment.status === 'ready');
    return {
      ok: ready,
      summary: ready ? 'Environment provisioned and ready.' : `Environment group is ${group.status}.`,
      data: {
        groupId: group.id,
        environments: group.environments.map((environment) => ({
          environmentId: environment.id,
          kind: environment.kind,
          status: environment.status,
          generation: environment.generation,
          recipeId: environment.recipeId,
        })),
      },
      artifactRefs: [],
      truncated: false,
      outcome: 'confirmed',
      verification: {
        status: ready ? 'verified' : 'failed',
        summary: ready
          ? 'Runner confirmed provisioning and the Environment is ready to start.'
          : 'Runner returned a terminal provisioning result that was not ready.',
        evidenceRefs: [],
      },
    };
  },
});

export const createEnvironmentControlTool = (
  environments: EnvironmentService,
  repository: EnvironmentRepositoryPort,
  cryptoHash: CryptoHashPort,
): AgentTool => ({
  descriptor: {
    name: 'environment_control',
    version: '1.0.0',
    description: 'Start, stop, restart, or delete this Run’s isolated Agent Environment. Requires user approval.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        environmentId: { type: 'string', minLength: 1, maxLength: 128 },
        action: { type: 'string', enum: ['start', 'stop', 'restart', 'delete'] },
      },
      required: ['environmentId', 'action'],
    },
    riskClass: 'mutate',
    capability: 'environment.manage',
  },
  inspect: async (input, context, policyRevision) => {
    const args = record(input);
    onlyKeys(args, ['environmentId', 'action', 'expectedVersion', 'generation', 'groupId']);
    const environmentId = stringValue(args.environmentId, 128);
    const action = stringValue(args.action, 16);
    if (!['start', 'stop', 'restart', 'delete'].includes(action)) throw new Error('TOOL_ARGUMENTS_INVALID');
    const environment = await repository.getEnvironment(context, environmentId);
    if (!environment) throw new Error('NOT_FOUND');
    const group = await repository.getGroup(context, environment.groupId);
    if (!group || group.runId !== context.runId || group.agentRuntimeId !== context.agentRuntimeId) {
      throw new Error('RESOURCE_FORBIDDEN');
    }
    const normalizedArguments: JsonValue = {
      environmentId,
      action,
      expectedVersion: environment.version,
      generation: environment.generation,
      groupId: environment.groupId,
    };
    const target = environmentTarget(cryptoHash, {
      environmentId,
      generation: environment.generation,
      runId: context.runId,
      agentRuntimeId: context.agentRuntimeId,
      configuration: {
        schemaVersion: 1,
        environmentId,
        generation: environment.generation,
        status: environment.status,
        version: environment.version,
      },
    });
    const resourceKeys = [`environment:${environmentId}:${environment.generation}`];
    const preconditions: ToolPrecondition[] = [
      {
        kind: 'environmentGeneration',
        key: environmentId,
        observedValue: {
          generation: environment.generation,
          version: environment.version,
          status: environment.status,
        },
      },
    ];
    return {
      toolName: 'environment_control',
      toolVersion: '1.0.0',
      normalizedArguments,
      target,
      resourceKeys,
      risk: action === 'delete' ? 'destructive' : 'mutate',
      mutation: true,
      operationHash: operation(
        cryptoHash,
        context,
        'environment_control',
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
    const environmentId = stringValue(args.environmentId, 128);
    const action = stringValue(args.action, 16) as 'start' | 'stop' | 'restart' | 'delete';
    const command = await environments.action(
      context,
      environmentId,
      action,
      positiveInteger(args.expectedVersion),
      {},
    );
    if (command.status === 'unknown' || command.status === 'pending' || command.status === 'running') {
      return {
        ok: false,
        summary: 'Environment control outcome could not be confirmed.',
        artifactRefs: [],
        truncated: false,
        outcome: 'unknown',
        errorCode: 'ENVIRONMENT_RECONCILIATION_REQUIRED',
        verification: {
          status: 'unverified',
          summary: 'Runner did not return a confirmed terminal result.',
          evidenceRefs: [],
        },
      };
    }
    const current = await repository.getEnvironment(context, environmentId);
    const ok = command.status === 'succeeded';
    return {
      ok,
      summary: ok ? `Environment ${action} completed.` : `Environment ${action} failed.`,
      data: {
        commandId: command.id,
        environmentId,
        status: current?.status ?? null,
        generation: current?.generation ?? positiveInteger(args.generation),
        error: command.result,
      },
      artifactRefs: [],
      truncated: false,
      outcome: 'confirmed',
      errorCode: ok ? undefined : 'ENVIRONMENT_ACTION_FAILED',
      verification: {
        status: ok ? 'verified' : 'failed',
        summary: 'Runner returned a terminal Environment lifecycle result.',
        evidenceRefs: [],
      },
    };
  },
});

export const createEnvironmentSwitchVersionsTool = (
  environments: EnvironmentService,
  repository: EnvironmentRepositoryPort,
  cryptoHash: CryptoHashPort,
): AgentTool => ({
  descriptor: {
    name: 'environment_switch_versions',
    version: '1.0.0',
    description:
      'Switch Node, Python, Go, or other allowed tool versions for this Workspace Environment. Recreates only this Workspace runtime generation and requires user approval.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        environmentId: { type: 'string', minLength: 1, maxLength: 128 },
        versions: {
          type: 'object',
          minProperties: 1,
          maxProperties: 32,
          additionalProperties: { type: 'string', minLength: 1, maxLength: 128 },
        },
      },
      required: ['environmentId', 'versions'],
    },
    riskClass: 'mutate',
    capability: 'environment.manage',
  },
  inspect: async (input, context, policyRevision) => {
    const args = record(input);
    onlyKeys(args, ['environmentId', 'versions', 'expectedVersion', 'generation', 'groupId', 'catalogRevision']);
    const environmentId = stringValue(args.environmentId, 128);
    const versions = versionsValue(args.versions);
    if (!Object.keys(versions).length) throw new Error('TOOL_ARGUMENTS_INVALID');
    const environment = await repository.getEnvironment(context, environmentId);
    if (!environment) throw new Error('NOT_FOUND');
    if (!['ready', 'running', 'stopped'].includes(environment.status)) throw new Error('ENVIRONMENT_STATE_INVALID');
    const group = await repository.getGroup(context, environment.groupId);
    if (!group || group.runId !== context.runId || group.agentRuntimeId !== context.agentRuntimeId) {
      throw new Error('RESOURCE_FORBIDDEN');
    }
    const catalog = await environments.catalog(context.signal);
    const recipe = catalog.recipes.find((candidate) => candidate.id === environment.recipeId);
    if (!recipe) throw new Error('ENVIRONMENT_RECIPE_NOT_FOUND');
    for (const [familyId, versionId] of Object.entries(versions)) {
      if (!recipe.allowedFamilies.includes(familyId)) throw new Error('ENVIRONMENT_PACK_FORBIDDEN');
      if (
        !catalog.packs.some(
          (pack) => pack.familyId === familyId && pack.versionId === versionId && pack.status !== 'unavailable',
        )
      ) {
        throw new Error('ENVIRONMENT_PACK_UNAVAILABLE');
      }
    }
    const normalizedArguments: JsonValue = {
      environmentId,
      versions,
      expectedVersion: environment.version,
      generation: environment.generation,
      groupId: environment.groupId,
      catalogRevision: catalog.revision,
    };
    const target = environmentTarget(cryptoHash, {
      environmentId,
      generation: environment.generation,
      runId: context.runId,
      agentRuntimeId: context.agentRuntimeId,
      configuration: {
        schemaVersion: 1,
        environmentId,
        generation: environment.generation,
        currentPackRefs: environment.packRefs.map((pack) => ({
          familyId: pack.familyId,
          versionId: pack.versionId,
          contentDigest: pack.contentDigest,
        })),
        requestedVersions: versions,
        catalogRevision: catalog.revision,
      },
    });
    const resourceKeys = [`environment:${environmentId}:${environment.generation}`];
    const preconditions: ToolPrecondition[] = [
      {
        kind: 'environmentGeneration',
        key: environmentId,
        observedValue: {
          generation: environment.generation,
          version: environment.version,
          status: environment.status,
        },
      },
      { kind: 'metadata', key: 'environmentCatalog', observedValue: { revision: catalog.revision } },
    ];
    return {
      toolName: 'environment_switch_versions',
      toolVersion: '1.0.0',
      normalizedArguments,
      target,
      resourceKeys,
      risk: 'mutate',
      mutation: true,
      operationHash: operation(
        cryptoHash,
        context,
        'environment_switch_versions',
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
    const environmentId = stringValue(args.environmentId, 128);
    const switched = await environments.switchVersions(
      context,
      environmentId,
      versionsValue(args.versions),
      positiveInteger(args.expectedVersion),
      stringValue(args.catalogRevision, 128),
    );
    const ok = switched.outcome === 'succeeded';
    return {
      ok,
      summary: ok
        ? `Workspace tool versions switched; Environment generation is now ${switched.environment.generation}.`
        : 'Workspace tool version switch did not complete successfully.',
      data: {
        environmentId,
        generation: switched.environment.generation,
        status: switched.environment.status,
        packRefs: switched.environment.packRefs.map((pack) => ({
          familyId: pack.familyId,
          versionId: pack.versionId,
          contentDigest: pack.contentDigest,
        })),
        commandIds: switched.commands.map((command) => command.id),
      },
      artifactRefs: [],
      truncated: false,
      outcome: switched.outcome === 'unknown' ? 'unknown' : 'confirmed',
      errorCode:
        switched.outcome === 'unknown'
          ? 'ENVIRONMENT_RECONCILIATION_REQUIRED'
          : switched.outcome === 'failed'
            ? 'ENVIRONMENT_VERSION_SWITCH_FAILED'
            : undefined,
      verification: {
        status: switched.outcome === 'succeeded' ? 'verified' : switched.outcome === 'failed' ? 'failed' : 'unverified',
        summary:
          switched.outcome === 'succeeded'
            ? 'Runner confirmed old-generation deletion, new-generation provisioning, and required restart.'
            : 'The complete generation transition was not confirmed.',
        evidenceRefs: [],
      },
    };
  },
});
