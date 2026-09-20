import type { JsonValue } from '../../agent.types';
import type { ArtifactService } from '../../ai/artifact.service';
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
const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;
const MIN_SCREENSHOT_BYTES = 64 * 1024;
const MAX_TRANSFER_BYTES = 8 * 1024 * 1024;
const MAX_SETTLE_MS = 2_000;
const MAX_WAIT_MS = 5_000;
const MAX_SCROLL_DELTA = 10_000;
const MAX_OPTION_BYTES = 512;
const MAX_ID_BYTES = 128;
const TOOL_VERSION = '1.0.0';

interface ResolvedBrowserBinding {
  target: BrowserTargetSnapshot;
  workspace: AgentWorkspaceView | null;
}

const browserTargetConfigurationHash = (
  target: Pick<BrowserTargetSnapshot, 'id' | 'endpoints' | 'allowedUrlPatterns'>,
  cryptoHash: CryptoHashPort,
): string =>
  hashOperation(
    {
      schemaVersion: 1,
      kind: 'browser-target',
      id: target.id,
      endpoints: target.endpoints.map((endpoint) => ({ ...endpoint })),
      allowedUrlPatterns: [...target.allowedUrlPatterns],
    },
    cryptoHash,
  );

const standaloneTargetRevision = (configurationHash: string): number => {
  const digest = configurationHash.startsWith('v1:') ? configurationHash.slice(3) : configurationHash;
  const revision = Number.parseInt(digest.slice(0, 13), 16) + 1;
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('BROWSER_TARGET_HASH_INVALID');
  return revision;
};

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

const stringArray = (
  value: JsonValue | undefined,
  options: { minItems: number; maxItems: number; maxBytes: number },
): string[] => {
  if (
    !Array.isArray(value) ||
    value.length < options.minItems ||
    value.length > options.maxItems ||
    value.some((item) => typeof item !== 'string' || Buffer.byteLength(item, 'utf8') > options.maxBytes)
  ) {
    throw new Error('TOOL_ARGUMENTS_INVALID');
  }
  return value as string[];
};

const artifactBytesForAgent = async (
  artifacts: ArtifactService,
  context: ToolContext,
  artifactId: string,
): Promise<{ id: string; name: string; mediaType: string; sha256: string; sizeBytes: number; bytes: Uint8Array }> => {
  const artifact = await artifacts.getForAgent(
    context,
    { runId: context.runId, runtimeId: context.agentRuntimeId },
    artifactId,
  );
  if (!artifact || artifact.status !== 'ready' || !artifact.sha256) throw new Error('ARTIFACT_NOT_AUTHORIZED_FOR_RUN');
  if (artifact.sizeBytes > MAX_TRANSFER_BYTES) throw new Error('BROWSER_UPLOAD_TOO_LARGE');
  const chunks: Uint8Array[] = [];
  if (artifact.sizeBytes > 0) {
    for await (const chunk of artifacts.readForAgent(
      context,
      { runId: context.runId, runtimeId: context.agentRuntimeId },
      artifact.id,
      { start: 0, endInclusive: artifact.sizeBytes - 1 },
    )) {
      chunks.push(chunk);
    }
  }
  const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  if (bytes.byteLength !== artifact.sizeBytes) throw new Error('ARTIFACT_UNAVAILABLE');
  return {
    id: artifact.id,
    name: artifact.originalName,
    mediaType: artifact.mediaType,
    sha256: artifact.sha256,
    sizeBytes: artifact.sizeBytes,
    bytes,
  };
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
  cryptoHash: CryptoHashPort,
  context: ToolContext,
  workspaceId: string,
): Promise<ResolvedBrowserBinding> => {
  const workspace = await workspaceForContext(repository, context, workspaceId);
  const frozen = workspace.profile.browserTarget!;
  const target = {
    id: frozen.id,
    profileRevision: frozen.profileRevision,
    endpoints: frozen.endpoints.map((endpoint) => ({ ...endpoint })),
    allowedUrlPatterns: [...frozen.allowedUrlPatterns],
  };
  return {
    workspace,
    target: {
      ...target,
      configurationHash: browserTargetConfigurationHash(target, cryptoHash),
    },
  };
};

const standaloneBinding = async (
  settings: AgentSettingsService,
  cryptoHash: CryptoHashPort,
  context: ToolContext,
  targetId: string,
): Promise<ResolvedBrowserBinding> => {
  const view = await settings.get(context.userId);
  const configured = view.effectiveSettings.browser.targets.find((candidate) => candidate.id === targetId);
  if (!configured) throw new Error('BROWSER_TARGET_NOT_FOUND');
  const target = {
    id: configured.id,
    endpoints: configured.endpoints.map((endpoint) => ({ ...endpoint })),
    allowedUrlPatterns: [...configured.allowedUrlPatterns],
  };
  const configurationHash = browserTargetConfigurationHash(target, cryptoHash);
  return {
    workspace: null,
    target: {
      ...target,
      profileRevision: standaloneTargetRevision(configurationHash),
      configurationHash,
    },
  };
};

const createBinding = async (
  repository: AgentWorkspaceRepositoryPort,
  settings: AgentSettingsService,
  cryptoHash: CryptoHashPort,
  context: ToolContext,
  args: Record<string, JsonValue>,
): Promise<ResolvedBrowserBinding> => {
  const hasWorkspace = args.workspaceId !== undefined;
  const hasTarget = args.targetId !== undefined;
  if (hasWorkspace === hasTarget) throw new Error('TOOL_ARGUMENTS_INVALID');
  return hasWorkspace
    ? workspaceBinding(repository, cryptoHash, context, string(args.workspaceId, MAX_ID_BYTES))
    : standaloneBinding(settings, cryptoHash, context, string(args.targetId, MAX_ID_BYTES));
};

const sessionBinding = async (
  repository: AgentWorkspaceRepositoryPort,
  settings: AgentSettingsService,
  gateway: BrowserGatewayPort,
  cryptoHash: CryptoHashPort,
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
    const binding = await workspaceBinding(repository, cryptoHash, context, session.workspaceId);
    if (
      binding.workspace!.generation !== session.generation ||
      binding.target.id !== session.targetId ||
      binding.target.profileRevision !== session.targetRevision ||
      binding.target.configurationHash !== session.targetConfigurationHash
    ) {
      await gateway.close(sessionId).catch(() => undefined);
      throw new Error('BROWSER_WORKSPACE_STALE');
    }
    return { session, binding };
  }
  if (session.generation !== null) throw new Error('BROWSER_WORKSPACE_BINDING_INVALID');
  let binding: ResolvedBrowserBinding;
  try {
    binding = await standaloneBinding(settings, cryptoHash, context, session.targetId);
  } catch (error) {
    if (error instanceof Error && error.message === 'BROWSER_TARGET_NOT_FOUND') {
      await gateway.close(sessionId).catch(() => undefined);
      throw new Error('BROWSER_TARGET_STALE');
    }
    throw error;
  }
  if (binding.target.configurationHash !== session.targetConfigurationHash) {
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
      target.configurationHash,
      workspace ? `${workspace.id}:${workspace.generation}:${target.profileRevision}` : 'standalone',
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
    `browser-target:${binding.target.id}:${binding.target.configurationHash}`,
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

const byteSource = (bytes: Uint8Array): AsyncIterable<Uint8Array> =>
  (async function* () {
    yield bytes;
  })();

export const createBrowserTools = (
  repository: AgentWorkspaceRepositoryPort,
  settings: AgentSettingsService,
  gateway: BrowserGatewayPort,
  cryptoHash: CryptoHashPort,
  artifacts?: ArtifactService,
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
      capability: 'browser.read',
    },
    inspect: async (input, context, policyRevision) => {
      const args = object(input);
      const binding = await createBinding(repository, settings, cryptoHash, context, args);
      const normalized: Record<string, JsonValue> = {
        targetId: binding.target.id,
        targetRevision: binding.target.profileRevision,
        targetConfigurationHash: binding.target.configurationHash,
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
        ? await workspaceBinding(repository, cryptoHash, context, string(args.workspaceId, MAX_ID_BYTES))
        : await standaloneBinding(settings, cryptoHash, context, targetId);
      if (
        binding.target.id !== targetId ||
        binding.target.profileRevision !== targetRevision ||
        binding.target.configurationHash !== string(args.targetConfigurationHash, 96)
      ) {
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
      parallelSafe: true,
      capability: 'browser.read',
    },
    inspect: async (input, context, policyRevision) => {
      const args = object(input);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      const { binding } = await sessionBinding(repository, settings, gateway, cryptoHash, context, sessionId);
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
      await sessionBinding(repository, settings, gateway, cryptoHash, context, sessionId);
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
  {
    descriptor: {
      name: 'browser_screenshot',
      version: TOOL_VERSION,
      description:
        'Capture the current Browser viewport as a bounded PNG Artifact for on-demand visual inspection. Use semantic browser_snapshot by default and call this only when page pixels are needed.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          maxBytes: {
            type: 'integer',
            minimum: MIN_SCREENSHOT_BYTES,
            maximum: MAX_SCREENSHOT_BYTES,
          },
        },
        required: ['sessionId'],
      },
      riskClass: 'read',
      parallelSafe: true,
      capability: 'browser.read',
    },
    inspect: async (input, context, policyRevision) => {
      const args = object(input);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      const { binding } = await sessionBinding(repository, settings, gateway, cryptoHash, context, sessionId);
      const normalized: JsonValue = {
        sessionId,
        maxBytes: integer(args.maxBytes, MAX_SCREENSHOT_BYTES, MIN_SCREENSHOT_BYTES, MAX_SCREENSHOT_BYTES),
      };
      return inspection(
        cryptoHash,
        context,
        'browser_screenshot',
        normalized,
        binding,
        sessionId,
        'read',
        false,
        policyRevision,
      );
    },
    execute: async (value, context) => {
      if (!artifacts) throw new Error('BROWSER_SCREENSHOT_ARTIFACT_STORE_UNAVAILABLE');
      const args = object(value.normalizedArguments);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      await sessionBinding(repository, settings, gateway, cryptoHash, context, sessionId);
      const maxBytes = integer(args.maxBytes, MAX_SCREENSHOT_BYTES, MIN_SCREENSHOT_BYTES, MAX_SCREENSHOT_BYTES);
      const capture = await gateway.screenshot(sessionId, { maxBytes }, context.signal);
      if (
        capture.mediaType !== 'image/png' ||
        capture.bytes.byteLength < 1 ||
        capture.bytes.byteLength > maxBytes ||
        !Number.isSafeInteger(capture.width) ||
        capture.width < 1 ||
        !Number.isSafeInteger(capture.height) ||
        capture.height < 1
      ) {
        throw new Error('BROWSER_SCREENSHOT_INVALID');
      }
      const reservation = await artifacts.begin(context, {
        name: `browser-${sessionId}.png`,
        mediaType: capture.mediaType,
        declaredBytes: capture.bytes.byteLength,
      });
      const artifact = await artifacts.write(
        context,
        reservation.artifactId,
        byteSource(capture.bytes),
        context.signal,
      );
      if (artifact.status !== 'ready' || !artifact.sha256) throw new Error('BROWSER_SCREENSHOT_ARTIFACT_UNAVAILABLE');
      return {
        ok: true,
        summary: 'Browser viewport screenshot captured as an image Artifact.',
        data: {
          type: 'browser_screenshot',
          sessionId: capture.sessionId,
          targetId: capture.targetId,
          generation: capture.generation,
          url: capture.url,
          title: capture.title,
          viewport: { width: capture.width, height: capture.height },
          artifact: {
            id: artifact.id,
            mediaType: artifact.mediaType,
            sha256: artifact.sha256,
            sizeBytes: artifact.sizeBytes,
          },
        },
        artifactRefs: [artifact.id],
        truncated: false,
        outcome: 'confirmed',
        verification: {
          status: 'verified',
          summary:
            'The screenshot bytes were captured from the current Browser viewport and persisted as a ready Artifact.',
          evidenceRefs: [artifact.id],
        },
      };
    },
  },
  ...(['navigate', 'click', 'type'] as const).map((action): AgentTool => ({
    descriptor: {
      name: `browser_${action}`,
      version: TOOL_VERSION,
      description:
        action === 'navigate'
          ? 'Navigate an existing Browser session to an allowlisted URL and return bounded post-action state.'
          : action === 'click'
            ? 'Click an opaque nodeRef from the latest Browser snapshot and return bounded post-action state.'
            : 'Type bounded text into an opaque nodeRef from the latest Browser snapshot and return bounded post-action state.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          settleMs: { type: 'integer', minimum: 0, maximum: MAX_SETTLE_MS },
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
      capability: action === 'navigate' ? 'browser.read' : 'browser.interact',
    },
    inspect: async (input, context, policyRevision) => {
      const args = object(input);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      const { binding } = await sessionBinding(repository, settings, gateway, cryptoHash, context, sessionId);
      const normalized: Record<string, JsonValue> = {
        sessionId,
        settleMs: integer(args.settleMs, 250, 0, MAX_SETTLE_MS),
      };
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
      await sessionBinding(repository, settings, gateway, cryptoHash, context, sessionId);
      const settleMs = integer(args.settleMs, 250, 0, MAX_SETTLE_MS);
      if (action === 'navigate') {
        const state = await gateway.navigate(sessionId, string(args.url, MAX_URL_BYTES), { settleMs }, context.signal);
        return result('Browser navigation completed.', state as unknown as JsonValue);
      }
      const snapshotId = string(args.snapshotId, MAX_ID_BYTES);
      const nodeRef = string(args.nodeRef, MAX_ID_BYTES);
      const state =
        action === 'click'
          ? await gateway.click(sessionId, snapshotId, nodeRef, { settleMs }, context.signal)
          : await gateway.type(
              sessionId,
              snapshotId,
              nodeRef,
              string(args.text, MAX_TYPE_BYTES, true),
              { settleMs },
              context.signal,
            );
      return result(`Browser ${action} completed.`, state as unknown as JsonValue);
    },
  })),
  {
    descriptor: {
      name: 'browser_scroll',
      version: TOOL_VERSION,
      description:
        'Scroll the current Browser page by bounded CSS-pixel deltas and return lightweight post-action state.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          deltaX: { type: 'integer', minimum: -MAX_SCROLL_DELTA, maximum: MAX_SCROLL_DELTA },
          deltaY: { type: 'integer', minimum: -MAX_SCROLL_DELTA, maximum: MAX_SCROLL_DELTA },
          settleMs: { type: 'integer', minimum: 0, maximum: MAX_SETTLE_MS },
        },
        required: ['sessionId', 'deltaY'],
      },
      riskClass: 'mutate',
      capability: 'browser.read',
    },
    inspect: async (input, context, policyRevision) => {
      const args = object(input);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      const { binding } = await sessionBinding(repository, settings, gateway, cryptoHash, context, sessionId);
      return inspection(
        cryptoHash,
        context,
        'browser_scroll',
        {
          sessionId,
          deltaX: integer(args.deltaX, 0, -MAX_SCROLL_DELTA, MAX_SCROLL_DELTA),
          deltaY: integer(args.deltaY, 0, -MAX_SCROLL_DELTA, MAX_SCROLL_DELTA),
          settleMs: integer(args.settleMs, 250, 0, MAX_SETTLE_MS),
        },
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
      await sessionBinding(repository, settings, gateway, cryptoHash, context, sessionId);
      const state = await gateway.scroll(
        sessionId,
        {
          deltaX: integer(args.deltaX, 0, -MAX_SCROLL_DELTA, MAX_SCROLL_DELTA),
          deltaY: integer(args.deltaY, 0, -MAX_SCROLL_DELTA, MAX_SCROLL_DELTA),
          settleMs: integer(args.settleMs, 250, 0, MAX_SETTLE_MS),
        },
        context.signal,
      );
      return result('Browser scroll completed.', state as unknown as JsonValue);
    },
  },
  {
    descriptor: {
      name: 'browser_press',
      version: TOOL_VERSION,
      description:
        'Press a bounded keyboard key or shortcut at page level or on an opaque nodeRef, then return lightweight post-action state.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          snapshotId: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          nodeRef: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          key: { type: 'string', minLength: 1, maxLength: 32 },
          modifiers: {
            type: 'array',
            maxItems: 4,
            uniqueItems: true,
            items: { type: 'string', enum: ['Alt', 'Control', 'Meta', 'Shift'] },
          },
          settleMs: { type: 'integer', minimum: 0, maximum: MAX_SETTLE_MS },
        },
        required: ['sessionId', 'key'],
      },
      riskClass: 'mutate',
      capability: 'browser.interact',
    },
    inspect: async (input, context, policyRevision) => {
      const args = object(input);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      const hasSnapshot = args.snapshotId !== undefined;
      const hasNode = args.nodeRef !== undefined;
      if (hasSnapshot !== hasNode) throw new Error('TOOL_ARGUMENTS_INVALID');
      const { binding } = await sessionBinding(repository, settings, gateway, cryptoHash, context, sessionId);
      const modifiers =
        args.modifiers === undefined ? [] : stringArray(args.modifiers, { minItems: 0, maxItems: 4, maxBytes: 16 });
      if (modifiers.some((modifier) => !['Alt', 'Control', 'Meta', 'Shift'].includes(modifier))) {
        throw new Error('TOOL_ARGUMENTS_INVALID');
      }
      const normalized: Record<string, JsonValue> = {
        sessionId,
        key: string(args.key, 32),
        modifiers,
        settleMs: integer(args.settleMs, 250, 0, MAX_SETTLE_MS),
      };
      if (hasSnapshot) {
        normalized.snapshotId = string(args.snapshotId, MAX_ID_BYTES);
        normalized.nodeRef = string(args.nodeRef, MAX_ID_BYTES);
      }
      return inspection(
        cryptoHash,
        context,
        'browser_press',
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
      await sessionBinding(repository, settings, gateway, cryptoHash, context, sessionId);
      const state = await gateway.press(
        sessionId,
        {
          key: string(args.key, 32),
          modifiers: stringArray(args.modifiers, { minItems: 0, maxItems: 4, maxBytes: 16 }),
          ...(args.snapshotId !== undefined
            ? {
                snapshotId: string(args.snapshotId, MAX_ID_BYTES),
                nodeRef: string(args.nodeRef, MAX_ID_BYTES),
              }
            : {}),
          settleMs: integer(args.settleMs, 250, 0, MAX_SETTLE_MS),
        },
        context.signal,
      );
      return result('Browser key press completed.', state as unknown as JsonValue);
    },
  },
  {
    descriptor: {
      name: 'browser_back',
      version: TOOL_VERSION,
      description: 'Navigate one history entry back and return lightweight post-action state.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          settleMs: { type: 'integer', minimum: 0, maximum: MAX_SETTLE_MS },
        },
        required: ['sessionId'],
      },
      riskClass: 'mutate',
      capability: 'browser.read',
    },
    inspect: async (input, context, policyRevision) => {
      const args = object(input);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      const { binding } = await sessionBinding(repository, settings, gateway, cryptoHash, context, sessionId);
      return inspection(
        cryptoHash,
        context,
        'browser_back',
        { sessionId, settleMs: integer(args.settleMs, 250, 0, MAX_SETTLE_MS) },
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
      await sessionBinding(repository, settings, gateway, cryptoHash, context, sessionId);
      const state = await gateway.back(
        sessionId,
        { settleMs: integer(args.settleMs, 250, 0, MAX_SETTLE_MS) },
        context.signal,
      );
      return result('Browser back navigation completed.', state as unknown as JsonValue);
    },
  },
  {
    descriptor: {
      name: 'browser_select',
      version: TOOL_VERSION,
      description:
        'Select one or more option values on an opaque select nodeRef from the latest Browser snapshot and return post-action state.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          snapshotId: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          nodeRef: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          values: {
            type: 'array',
            minItems: 1,
            maxItems: 16,
            items: { type: 'string', maxLength: MAX_OPTION_BYTES },
          },
          settleMs: { type: 'integer', minimum: 0, maximum: MAX_SETTLE_MS },
        },
        required: ['sessionId', 'snapshotId', 'nodeRef', 'values'],
      },
      riskClass: 'mutate',
      capability: 'browser.interact',
    },
    inspect: async (input, context, policyRevision) => {
      const args = object(input);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      const { binding } = await sessionBinding(repository, settings, gateway, cryptoHash, context, sessionId);
      return inspection(
        cryptoHash,
        context,
        'browser_select',
        {
          sessionId,
          snapshotId: string(args.snapshotId, MAX_ID_BYTES),
          nodeRef: string(args.nodeRef, MAX_ID_BYTES),
          values: stringArray(args.values, { minItems: 1, maxItems: 16, maxBytes: MAX_OPTION_BYTES }),
          settleMs: integer(args.settleMs, 250, 0, MAX_SETTLE_MS),
        },
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
      await sessionBinding(repository, settings, gateway, cryptoHash, context, sessionId);
      const state = await gateway.select(
        sessionId,
        string(args.snapshotId, MAX_ID_BYTES),
        string(args.nodeRef, MAX_ID_BYTES),
        stringArray(args.values, { minItems: 1, maxItems: 16, maxBytes: MAX_OPTION_BYTES }),
        { settleMs: integer(args.settleMs, 250, 0, MAX_SETTLE_MS) },
        context.signal,
      );
      return result('Browser selection completed.', state as unknown as JsonValue);
    },
  },
  {
    descriptor: {
      name: 'browser_wait',
      version: TOOL_VERSION,
      description:
        'Wait for a bounded timeout or network-idle condition. Waiting invalidates old nodeRefs because the page may change asynchronously.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          mode: { type: 'string', enum: ['timeout', 'networkIdle'] },
          maxMillis: { type: 'integer', minimum: 1, maximum: MAX_WAIT_MS },
        },
        required: ['sessionId', 'mode', 'maxMillis'],
      },
      riskClass: 'control',
      capability: 'browser.read',
    },
    inspect: async (input, context, policyRevision) => {
      const args = object(input);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      const mode = string(args.mode, 32);
      if (mode !== 'timeout' && mode !== 'networkIdle') throw new Error('TOOL_ARGUMENTS_INVALID');
      const { binding } = await sessionBinding(repository, settings, gateway, cryptoHash, context, sessionId);
      return inspection(
        cryptoHash,
        context,
        'browser_wait',
        { sessionId, mode, maxMillis: integer(args.maxMillis, 1000, 1, MAX_WAIT_MS) },
        binding,
        sessionId,
        'control',
        false,
        policyRevision,
      );
    },
    execute: async (value, context) => {
      const args = object(value.normalizedArguments);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      await sessionBinding(repository, settings, gateway, cryptoHash, context, sessionId);
      const mode = string(args.mode, 32);
      if (mode !== 'timeout' && mode !== 'networkIdle') throw new Error('TOOL_ARGUMENTS_INVALID');
      const state = await gateway.wait(
        sessionId,
        { mode, maxMillis: integer(args.maxMillis, 1000, 1, MAX_WAIT_MS) },
        context.signal,
      );
      return result('Browser wait completed.', state as unknown as JsonValue);
    },
  },
  {
    descriptor: {
      name: 'browser_console',
      version: TOOL_VERSION,
      description:
        'Read a bounded cursor-based slice of Browser console output. This is read-only and does not expose JavaScript evaluation.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          afterCursor: { type: 'integer', minimum: 0 },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          maxBytes: { type: 'integer', minimum: 256, maximum: 65536 },
        },
        required: ['sessionId'],
      },
      riskClass: 'read',
      parallelSafe: true,
      capability: 'browser.read',
    },
    inspect: async (input, context, policyRevision) => {
      const args = object(input);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      const { binding } = await sessionBinding(repository, settings, gateway, cryptoHash, context, sessionId);
      return inspection(
        cryptoHash,
        context,
        'browser_console',
        {
          sessionId,
          afterCursor: integer(args.afterCursor, 0, 0, Number.MAX_SAFE_INTEGER),
          limit: integer(args.limit, 50, 1, 100),
          maxBytes: integer(args.maxBytes, Math.min(16 * 1024, context.maxOutputBytes), 256, 65536),
        },
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
      await sessionBinding(repository, settings, gateway, cryptoHash, context, sessionId);
      const view = await gateway.console(
        sessionId,
        {
          afterCursor: integer(args.afterCursor, 0, 0, Number.MAX_SAFE_INTEGER),
          limit: integer(args.limit, 50, 1, 100),
          maxBytes: integer(args.maxBytes, Math.min(16 * 1024, context.maxOutputBytes), 256, 65536),
        },
        context.signal,
      );
      return { ...result('Browser console read completed.', view as unknown as JsonValue), truncated: view.truncated };
    },
  },
  {
    descriptor: {
      name: 'browser_upload',
      version: TOOL_VERSION,
      description:
        'Upload one Run-authorized Nexus Artifact into an opaque file-input nodeRef. No Backend or Browser host path is accepted.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          snapshotId: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          nodeRef: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          artifactId: { type: 'string', minLength: 36, maxLength: 36 },
          settleMs: { type: 'integer', minimum: 0, maximum: MAX_SETTLE_MS },
        },
        required: ['sessionId', 'snapshotId', 'nodeRef', 'artifactId'],
      },
      riskClass: 'mutate',
      capability: 'browser.interact',
    },
    inspect: async (input, context, policyRevision) => {
      if (!artifacts) throw new Error('BROWSER_ARTIFACT_STORE_UNAVAILABLE');
      const args = object(input);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      const artifactId = string(args.artifactId, 36);
      const source = await artifacts.getForAgent(
        context,
        { runId: context.runId, runtimeId: context.agentRuntimeId },
        artifactId,
      );
      if (!source || source.status !== 'ready' || !source.sha256) throw new Error('ARTIFACT_NOT_AUTHORIZED_FOR_RUN');
      if (source.sizeBytes > MAX_TRANSFER_BYTES) throw new Error('BROWSER_UPLOAD_TOO_LARGE');
      const { binding } = await sessionBinding(repository, settings, gateway, cryptoHash, context, sessionId);
      return inspection(
        cryptoHash,
        context,
        'browser_upload',
        {
          sessionId,
          snapshotId: string(args.snapshotId, MAX_ID_BYTES),
          nodeRef: string(args.nodeRef, MAX_ID_BYTES),
          artifactId,
          sourceSha256: source.sha256,
          sourceSizeBytes: source.sizeBytes,
          settleMs: integer(args.settleMs, 250, 0, MAX_SETTLE_MS),
        },
        binding,
        sessionId,
        'mutate',
        true,
        policyRevision,
      );
    },
    execute: async (value, context) => {
      if (!artifacts) throw new Error('BROWSER_ARTIFACT_STORE_UNAVAILABLE');
      const args = object(value.normalizedArguments);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      await sessionBinding(repository, settings, gateway, cryptoHash, context, sessionId);
      const source = await artifactBytesForAgent(artifacts, context, string(args.artifactId, 36));
      if (
        source.sha256 !== string(args.sourceSha256, 128) ||
        source.sizeBytes !== integer(args.sourceSizeBytes, -1, 0, MAX_TRANSFER_BYTES)
      ) {
        throw new Error('RESOURCE_CHANGED');
      }
      const state = await gateway.upload(
        sessionId,
        string(args.snapshotId, MAX_ID_BYTES),
        string(args.nodeRef, MAX_ID_BYTES),
        { name: source.name, mediaType: source.mediaType, bytes: source.bytes },
        { settleMs: integer(args.settleMs, 250, 0, MAX_SETTLE_MS) },
        context.signal,
      );
      return {
        ...result('Browser Artifact upload completed.', {
          state: state as unknown as JsonValue,
          sourceArtifact: {
            id: source.id,
            name: source.name,
            mediaType: source.mediaType,
            sha256: source.sha256,
            sizeBytes: source.sizeBytes,
          },
        }),
        artifactRefs: [source.id],
      };
    },
  },
  {
    descriptor: {
      name: 'browser_download',
      version: TOOL_VERSION,
      description:
        'Fetch a download link from the latest Browser snapshot through the live page session, bound bytes, and persist the result as a Nexus Artifact. No Browser host filesystem path is exposed.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          snapshotId: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          nodeRef: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
          maxBytes: { type: 'integer', minimum: 1, maximum: MAX_TRANSFER_BYTES },
        },
        required: ['sessionId', 'snapshotId', 'nodeRef'],
      },
      riskClass: 'read',
      capability: 'browser.read',
    },
    inspect: async (input, context, policyRevision) => {
      if (!artifacts) throw new Error('BROWSER_ARTIFACT_STORE_UNAVAILABLE');
      const args = object(input);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      const { binding } = await sessionBinding(repository, settings, gateway, cryptoHash, context, sessionId);
      return inspection(
        cryptoHash,
        context,
        'browser_download',
        {
          sessionId,
          snapshotId: string(args.snapshotId, MAX_ID_BYTES),
          nodeRef: string(args.nodeRef, MAX_ID_BYTES),
          maxBytes: integer(args.maxBytes, MAX_TRANSFER_BYTES, 1, MAX_TRANSFER_BYTES),
        },
        binding,
        sessionId,
        'read',
        false,
        policyRevision,
      );
    },
    execute: async (value, context) => {
      if (!artifacts) throw new Error('BROWSER_ARTIFACT_STORE_UNAVAILABLE');
      const args = object(value.normalizedArguments);
      const sessionId = string(args.sessionId, MAX_ID_BYTES);
      await sessionBinding(repository, settings, gateway, cryptoHash, context, sessionId);
      const downloaded = await gateway.download(
        sessionId,
        string(args.snapshotId, MAX_ID_BYTES),
        string(args.nodeRef, MAX_ID_BYTES),
        { maxBytes: integer(args.maxBytes, MAX_TRANSFER_BYTES, 1, MAX_TRANSFER_BYTES) },
        context.signal,
      );
      const reservation = await artifacts.begin(context, {
        name: downloaded.name,
        mediaType: downloaded.mediaType,
        declaredBytes: downloaded.bytes.byteLength,
      });
      const artifact = await artifacts.write(
        context,
        reservation.artifactId,
        byteSource(downloaded.bytes),
        context.signal,
      );
      if (artifact.status !== 'ready' || !artifact.sha256) throw new Error('BROWSER_DOWNLOAD_ARTIFACT_UNAVAILABLE');
      return {
        ok: true,
        summary: 'Browser download persisted as a ready Artifact.',
        data: {
          sessionId: downloaded.sessionId,
          targetId: downloaded.targetId,
          generation: downloaded.generation,
          url: downloaded.url,
          artifact: {
            id: artifact.id,
            name: artifact.originalName,
            mediaType: artifact.mediaType,
            sha256: artifact.sha256,
            sizeBytes: artifact.sizeBytes,
          },
        },
        artifactRefs: [artifact.id],
        truncated: false,
        outcome: 'confirmed',
        verification: {
          status: 'verified',
          summary:
            'The bounded response bytes were fetched through the live Browser page session and persisted as a ready Artifact.',
          evidenceRefs: [artifact.id],
        },
      };
    },
  },
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
      capability: 'browser.read',
    },
    inspect: async (input, context, policyRevision) => {
      const sessionId = string(object(input).sessionId, MAX_ID_BYTES);
      const { binding } = await sessionBinding(repository, settings, gateway, cryptoHash, context, sessionId);
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
      await sessionBinding(repository, settings, gateway, cryptoHash, context, sessionId);
      await gateway.close(sessionId);
      return result('Browser session closed.');
    },
  },
];
