import type { JsonValue } from '../../agent.types';
import type { BrowserGatewayPort, BrowserSessionView, BrowserTargetSnapshot } from '../../ai/integrations.types';
import type {
  AgentTool,
  ToolContext,
  ToolInspection,
  ToolPrecondition,
  ToolResult,
} from '../../capabilities/tool.types';
import type { CryptoHashPort } from '../../crypto-hash.port';
import type { AgentSettingsService } from '../../host/agent-settings.service';
import { hashOperation } from '../../operation-hash';
import type { AgentWorkspaceRepositoryPort } from '../../workspace-runtime/workspace-runtime.repository.port';
import type { AgentWorkspaceView } from '../../workspace-runtime/workspace-runtime.types';

const MAX_URL_BYTES = 8 * 1024;
const MAX_TYPE_BYTES = 16 * 1024;
const MAX_ID_BYTES = 128;
const TOOL_VERSION = '1.0.0';

interface ResolvedBrowserBinding {
  target: BrowserTargetSnapshot;
  workspace: AgentWorkspaceView | null;
}

const object = (value: JsonValue): Record<string, JsonValue> => {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('TOOL_ARGUMENTS_INVALID');
  return value as Record<string, JsonValue>;
};

const string = (value: JsonValue | undefined, maxBytes: number, allowEmpty = false): string => {
  if (
    typeof value !== 'string' ||
    value.includes('\0') ||
    (!allowEmpty && !value.trim()) ||
    Buffer.byteLength(value, 'utf8') > maxBytes
  ) {
    throw new Error('TOOL_ARGUMENTS_INVALID');
  }
  return allowEmpty ? value : value.trim();
};

const integer = (value: JsonValue | undefined, fallback: number, min: number, max: number): number => {
  const candidate = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(candidate) || candidate < min || candidate > max) throw new Error('TOOL_ARGUMENTS_INVALID');
  return candidate;
};

const workspaceForContext = async (
  repository: AgentWorkspaceRepositoryPort,
  context: ToolContext,
  workspaceId: string,
): Promise<AgentWorkspaceView> => {
  const workspace = await repository.getWorkspace(context, workspaceId);
  if (!workspace) throw new Error('NOT_FOUND');
  if (workspace.runId !== context.runId || workspace.agentRuntimeId !== context.agentRuntimeId) {
    throw new Error('RESOURCE_FORBIDDEN');
  }
  if (workspace.status !== 'running') throw new Error('WORKSPACE_NOT_RUNNING');
  if (!workspace.profile.browserTarget) throw new Error('BROWSER_TARGET_NOT_CONFIGURED');
  return workspace;
};

const workspaceBinding = async (
  repository: AgentWorkspaceRepositoryPort,
  context: ToolContext,
  workspaceId: string,
): Promise<ResolvedBrowserBinding> => {
  const workspace = await workspaceForContext(repository, context, workspaceId);
  const frozen = workspace.profile.browserTarget!;
  return {
    workspace,
    target: {
      id: frozen.id,
      profileRevision: frozen.profileRevision,
      endpoints: frozen.endpoints.map((endpoint) => ({ ...endpoint })),
      allowedUrlPatterns: [...frozen.allowedUrlPatterns],
    },
  };
};

const standaloneBinding = async (
  settings: AgentSettingsService,
  context: ToolContext,
  targetId: string,
): Promise<ResolvedBrowserBinding> => {
  const view = await settings.get(context.userId);
  const configured = view.effectiveSettings.browser.targets.find((candidate) => candidate.id === targetId);
  if (!configured) throw new Error('BROWSER_TARGET_NOT_FOUND');
  return {
    workspace: null,
    target: {
      id: configured.id,
      profileRevision: view.revision,
      endpoints: configured.endpoints.map((endpoint) => ({ ...endpoint })),
      allowedUrlPatterns: [...configured.allowedUrlPatterns],
    },
  };
};

const createBinding = async (
  repository: AgentWorkspaceRepositoryPort,
  settings: AgentSettingsService,
  context: ToolContext,
  args: Record<string, JsonValue>,
): Promise<ResolvedBrowserBinding> => {
  const hasWorkspace = args.workspaceId !== undefined;
  const hasTarget = args.targetId !== undefined;
  if (hasWorkspace === hasTarget) throw new Error('TOOL_ARGUMENTS_INVALID');
  return hasWorkspace
    ? workspaceBinding(repository, context, string(args.workspaceId, MAX_ID_BYTES))
    : standaloneBinding(settings, context, string(args.targetId, MAX_ID_BYTES));
};

const sessionBinding = async (
  repository: AgentWorkspaceRepositoryPort,
  settings: AgentSettingsService,
  gateway: BrowserGatewayPort,
  context: ToolContext,
  sessionId: string,
): Promise<{ session: BrowserSessionView; binding: ResolvedBrowserBinding }> => {
  const session = await gateway.getSession(sessionId, context.signal);
  if (
    session.userId !== context.userId ||
    session.appId !== context.appId ||
    session.runId !== context.runId ||
    session.agentRuntimeId !== context.agentRuntimeId
  ) {
    throw new Error('RESOURCE_FORBIDDEN');
  }
  if (session.workspaceId) {
    if (session.generation === null) throw new Error('BROWSER_WORKSPACE_BINDING_INVALID');
    const binding = await workspaceBinding(repository, context, session.workspaceId);
    if (
      binding.workspace!.generation !== session.generation ||
      binding.target.id !== session.targetId ||
      binding.target.profileRevision !== session.targetRevision
    ) {
      await gateway.close(sessionId).catch(() => undefined);
      throw new Error('BROWSER_WORKSPACE_STALE');
    }
    return { session, binding };
  }
  if (session.generation !== null) throw new Error('BROWSER_WORKSPACE_BINDING_INVALID');
  const binding = await standaloneBinding(settings, context, session.targetId);
  if (binding.target.profileRevision !== session.targetRevision) {
    await gateway.close(sessionId).catch(() => undefined);
    throw new Error('BROWSER_TARGET_STALE');
  }
  return { session, binding };
};

const toolTarget = (
  binding: ResolvedBrowserBinding,
  cryptoHash: CryptoHashPort,
  sessionId?: string,
): ToolInspection['target'] => {
  const workspace = binding.workspace;
  const target = binding.target;
  return {
    kind: 'browser',
    ...(workspace ? { workspaceId: workspace.id, generation: workspace.generation } : {}),
    ...(sessionId ? { browserSessionId: sessionId } : {}),
    targetIdentity: [
      'browser',
      target.id,
      String(target.profileRevision),
      workspace ? `${workspace.id}:${workspace.generation}` : 'standalone',
      sessionId ?? 'new',
    ].join(':'),
    endpoint: `browser-target:${target.id}`,
    loginUser: 'browser-runtime',
    configurationHash: hashOperation(
      {
        schemaVersion: 1,
        target: {
          id: target.id,
          profileRevision: target.profileRevision,
          endpoints: target.endpoints.map((endpoint) => ({ ...endpoint })),
          allowedUrlPatterns: [...target.allowedUrlPatterns],
        },
        workspace: workspace ? { id: workspace.id, generation: workspace.generation } : null,
      },
      cryptoHash,
    ),
  };
};

const inspection = (
  cryptoHash: CryptoHashPort,
  context: ToolContext,
  name: string,
  normalizedArguments: JsonValue,
  binding: ResolvedBrowserBinding,
  sessionId: string | undefined,
  risk: 'read' | 'control' | 'mutate',
  mutation: boolean,
  policyRevision: number,
): ToolInspection => {
  const target = toolTarget(binding, cryptoHash, sessionId);
  const resourceKeys = [
    `browser-target:${binding.target.id}:${binding.target.profileRevision}`,
    ...(binding.workspace ? [`workspace:${binding.workspace.id}:${binding.workspace.generation}`] : []),
    ...(sessionId ? [`browser:${sessionId}`] : []),
  ];
  const preconditions: ToolPrecondition[] = binding.workspace
    ? [
        {
          kind: 'workspaceGeneration',
          key: binding.workspace.id,
          observedValue: { generation: binding.workspace.generation },
        },
      ]
    : [
        {
          kind: 'metadata',
          key: `browser-target:${binding.target.id}`,
          observedValue: { revision: binding.target.profileRevision },
        },
      ];
  return {
    toolName: name,
    toolVersion: TOOL_VERSION,
    normalizedArguments,
    target,
    resourceKeys,
    risk,
    mutation,
    operationHash: hashOperation(
      {
        schemaVersion: 1,
        scope: {
          userId: context.userId,
          appId: context.appId,
          runId: context.runId,
          agentRuntimeId: context.agentRuntimeId,
        },
        tool: { name, version: TOOL_VERSION },
        target: {
          kind: target.kind,
          workspaceId: target.workspaceId ?? null,
          generation: target.generation ?? null,
          browserSessionId: target.browserSessionId ?? null,
          targetIdentity: target.targetIdentity,
          endpoint: target.endpoint,
          configurationHash: target.configurationHash,
        },
        arguments: normalizedArguments,
        resourceKeys,
        preconditions: preconditions.map((item) => ({
          kind: item.kind,
          key: item.key,
          observedValue: item.observedValue,
        })),
        policyRevision,
        inputRevision: context.inputRevision,
      },
      cryptoHash,
    ),
    operationHashVersion: 1,
    preconditions,
    secretRefs: [],
    policyRevision,
    inputRevision: context.inputRevision,
  };
};

const result = (summary: string, data?: JsonValue): ToolResult => ({
  ok: true,
  summary,
  ...(data === undefined ? {} : { data }),
  artifactRefs: [],
  truncated: false,
  outcome: 'confirmed',
  verification: {
    status: 'unverified',
    summary: 'Browser protocol completion is not independent verification of page-side effects.',
    evidenceRefs: [],
  },
});

export const createBrowserTools = (
  repository: AgentWorkspaceRepositoryPort,
  settings: AgentSettingsService,
  gateway: BrowserGatewayPort,
  cryptoHash: CryptoHashPort,
): AgentTool[] => [
  {
    descriptor: {
      name: 'browser_create_session',
      version: TOOL_VERSION,
      description:
        'Create a Browser session using either a configured standalone targetId or the Browser target frozen into a running Workspace.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          targetId: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          workspaceId: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
        },
      },
      riskClass: 'control',
      capability: 'browser.operate',
    },
    inspect: async (input, context, policyRevision) => {
      const args = object(input);
      const binding = await createBinding(repository, settings, context, args);
      const normalized: Record<string, JsonValue> = {
        targetId: binding.target.id,
        targetRevision: binding.target.profileRevision,
      };
      if (binding.workspace) {
        normalized.workspaceId = binding.workspace.id;
        normalized.generation = binding.workspace.generation;
      }
      return inspection(
        cryptoHash,
        context,
        'browser_create_session',
        normalized,
        binding,
        undefined,
        'control',
        false,
        policyRevision,
      );
    },
    execute: async (value, context) => {
      const args = object(value.normalizedArguments);
      const targetId = string(args.targetId, MAX_ID_BYTES);
      const targetRevision = integer(args.targetRevision, 0, 1, Number.MAX_SAFE_INTEGER);
      const binding = args.workspaceId
        ? await workspaceBinding(repository, context, string(args.workspaceId, MAX_ID_BYTES))
        : await standaloneBinding(settings, context, targetId);
      if (binding.target.id !== targetId || binding.target.profileRevision !== targetRevision) {
        throw new Error('RESOURCE_CHANGED');
      }
      if (
        binding.workspace &&
        binding.workspace.generation !== integer(args.generation, 0, 1, Number.MAX_SAFE_INTEGER)
      ) {
        throw new Error('RESOURCE_CHANGED');
      }
      const session = await gateway.createSession(
        {
          userId: context.userId,
          appId: context.appId,
          runId: context.runId,
          agentRuntimeId: context.agentRuntimeId,
          target: binding.target,
          ...(binding.workspace ? { workspaceId: binding.workspace.id, generation: binding.workspace.generation } : {}),
        },
        context.signal,
      );
      return result('Browser session created.', session as unknown as JsonValue);
    },
  },
  {
    descriptor: {
      name: 'browser_snapshot',
      version: TOOL_VERSION,
      description: 'Capture a bounded semantic snapshot of a Browser session and return opaque node references.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          maxNodes: { type: 'integer', minimum: 1, maximum: 2000 },
          maxBytes: { type: 'integer', minimum: 1024, maximum: 65536 },
        },
        required: ['sessionId'],
      },
      riskClass: 'read',
      capability: 'browser.operate',
    },
    inspect: async (input, context, policyRevision) => {
      const args = object(input);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      const { binding } = await sessionBinding(repository, settings, gateway, context, sessionId);
      const normalized: JsonValue = {
        sessionId,
        maxNodes: integer(args.maxNodes, 1000, 1, 2000),
        maxBytes: integer(args.maxBytes, Math.min(65536, context.maxOutputBytes), 1024, 65536),
      };
      return inspection(
        cryptoHash,
        context,
        'browser_snapshot',
        normalized,
        binding,
        sessionId,
        'read',
        false,
        policyRevision,
      );
    },
    execute: async (value, context) => {
      const args = object(value.normalizedArguments);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      await sessionBinding(repository, settings, gateway, context, sessionId);
      const snapshot = await gateway.snapshot(
        sessionId,
        {
          maxNodes: integer(args.maxNodes, 1000, 1, 2000),
          maxBytes: integer(args.maxBytes, 65536, 1024, 65536),
        },
        context.signal,
      );
      return {
        ...result('Browser snapshot captured.', snapshot as unknown as JsonValue),
        truncated: snapshot.truncated,
      };
    },
  },
  ...(['navigate', 'click', 'type'] as const).map((action): AgentTool => ({
    descriptor: {
      name: `browser_${action}`,
      version: TOOL_VERSION,
      description:
        action === 'navigate'
          ? 'Navigate an existing Browser session to an allowlisted URL.'
          : action === 'click'
            ? 'Click an opaque nodeRef from the latest Browser snapshot.'
            : 'Type bounded text into an opaque nodeRef from the latest Browser snapshot.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          ...(action === 'navigate'
            ? { url: { type: 'string', minLength: 1, maxLength: MAX_URL_BYTES } }
            : {
                snapshotId: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
                nodeRef: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
                ...(action === 'type' ? { text: { type: 'string', maxLength: MAX_TYPE_BYTES } } : {}),
              }),
        },
        required: [
          'sessionId',
          ...(action === 'navigate' ? ['url'] : ['snapshotId', 'nodeRef', ...(action === 'type' ? ['text'] : [])]),
        ],
      },
      riskClass: 'mutate',
      capability: 'browser.operate',
    },
    inspect: async (input, context, policyRevision) => {
      const args = object(input);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      const { binding } = await sessionBinding(repository, settings, gateway, context, sessionId);
      const normalized: Record<string, JsonValue> = { sessionId };
      if (action === 'navigate') normalized.url = string(args.url, MAX_URL_BYTES);
      else {
        normalized.snapshotId = string(args.snapshotId, MAX_ID_BYTES);
        normalized.nodeRef = string(args.nodeRef, MAX_ID_BYTES);
        if (action === 'type') normalized.text = string(args.text, MAX_TYPE_BYTES, true);
      }
      return inspection(
        cryptoHash,
        context,
        `browser_${action}`,
        normalized,
        binding,
        sessionId,
        'mutate',
        true,
        policyRevision,
      );
    },
    execute: async (value, context) => {
      const args = object(value.normalizedArguments);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      await sessionBinding(repository, settings, gateway, context, sessionId);
      if (action === 'navigate') {
        const session = await gateway.navigate(sessionId, string(args.url, MAX_URL_BYTES), context.signal);
        return result('Browser navigation completed.', session as unknown as JsonValue);
      }
      const snapshotId = string(args.snapshotId, MAX_ID_BYTES);
      const nodeRef = string(args.nodeRef, MAX_ID_BYTES);
      if (action === 'click') await gateway.click(sessionId, snapshotId, nodeRef, context.signal);
      else await gateway.type(sessionId, snapshotId, nodeRef, string(args.text, MAX_TYPE_BYTES, true), context.signal);
      return result(`Browser ${action} completed.`);
    },
  })),
  {
    descriptor: {
      name: 'browser_close',
      version: TOOL_VERSION,
      description: 'Close a Browser session owned by the current Agent runtime.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { sessionId: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES } },
        required: ['sessionId'],
      },
      riskClass: 'control',
      capability: 'browser.operate',
    },
    inspect: async (input, context, policyRevision) => {
      const sessionId = string(object(input).sessionId, MAX_ID_BYTES);
      const { binding } = await sessionBinding(repository, settings, gateway, context, sessionId);
      return inspection(
        cryptoHash,
        context,
        'browser_close',
        { sessionId },
        binding,
        sessionId,
        'control',
        false,
        policyRevision,
      );
    },
    execute: async (value, context) => {
      const sessionId = string(object(value.normalizedArguments).sessionId, MAX_ID_BYTES);
      await sessionBinding(repository, settings, gateway, context, sessionId);
      await gateway.close(sessionId);
      return result('Browser session closed.');
    },
  },
];
