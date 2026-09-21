import { logErrorCode, logger } from '../../../../../shared/logging/logger';
import type { JsonValue } from '../../../agent.types';
import type { BrowserGatewayPort, BrowserSessionView, BrowserTargetSnapshot } from '../../../ai/integrations.types';
import type { ToolContext, ToolInspection, ToolPrecondition } from '../../../capabilities/tool.types';
import type { CryptoHashPort } from '../../../crypto-hash.port';
import type { AgentSettingsService } from '../../../host/agent-settings.service';
import { hashOperation } from '../../../operation-hash';
import type { AgentWorkspaceRepositoryPort } from '../../../workspace-runtime/workspace-runtime.repository.port';
import type { AgentWorkspaceView } from '../../../workspace-runtime/workspace-runtime.types';
import { MAX_ID_BYTES, TOOL_VERSION, browserToolInteger, browserToolString } from './browser-tool-common';

export interface ResolvedBrowserBinding {
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

export class BrowserSessionBindingAuthority {
  constructor(
    private readonly repository: AgentWorkspaceRepositoryPort,
    private readonly settings: AgentSettingsService,
    private readonly gateway: BrowserGatewayPort,
    private readonly cryptoHash: CryptoHashPort,
  ) {}

  async createBinding(context: ToolContext, args: Record<string, JsonValue>): Promise<ResolvedBrowserBinding> {
    const hasWorkspace = args.workspaceId !== undefined;
    const hasTarget = args.targetId !== undefined;
    if (hasWorkspace === hasTarget) throw new Error('TOOL_ARGUMENTS_INVALID');
    return hasWorkspace
      ? this.workspaceBinding(context, browserToolString(args.workspaceId, MAX_ID_BYTES))
      : this.standaloneBinding(context, browserToolString(args.targetId, MAX_ID_BYTES));
  }

  async workspaceBinding(context: ToolContext, workspaceId: string): Promise<ResolvedBrowserBinding> {
    const workspace = await this.repository.getWorkspace(context, workspaceId);
    if (!workspace) throw new Error('NOT_FOUND');
    if (workspace.runId !== context.runId || workspace.agentRuntimeId !== context.agentRuntimeId) {
      throw new Error('RESOURCE_FORBIDDEN');
    }
    if (workspace.status !== 'running') throw new Error('WORKSPACE_NOT_RUNNING');
    if (!workspace.profile.browserTarget) throw new Error('BROWSER_TARGET_NOT_CONFIGURED');
    const frozen = workspace.profile.browserTarget;
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
        configurationHash: browserTargetConfigurationHash(target, this.cryptoHash),
      },
    };
  }

  async standaloneBinding(context: ToolContext, targetId: string): Promise<ResolvedBrowserBinding> {
    const view = await this.settings.get(context.userId);
    const configured = view.effectiveSettings.browser.targets.find((candidate) => candidate.id === targetId);
    if (!configured) throw new Error('BROWSER_TARGET_NOT_FOUND');
    const target = {
      id: configured.id,
      endpoints: configured.endpoints.map((endpoint) => ({ ...endpoint })),
      allowedUrlPatterns: [...configured.allowedUrlPatterns],
    };
    const configurationHash = browserTargetConfigurationHash(target, this.cryptoHash);
    return {
      workspace: null,
      target: {
        ...target,
        profileRevision: standaloneTargetRevision(configurationHash),
        configurationHash,
      },
    };
  }

  async session(
    context: ToolContext,
    sessionId: string,
  ): Promise<{ session: BrowserSessionView; binding: ResolvedBrowserBinding }> {
    const session = await this.gateway.getSession(sessionId, context.signal);
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
      const binding = await this.workspaceBinding(context, session.workspaceId);
      if (
        binding.workspace!.generation !== session.generation ||
        binding.target.id !== session.targetId ||
        binding.target.profileRevision !== session.targetRevision ||
        binding.target.configurationHash !== session.targetConfigurationHash
      ) {
        await this.gateway
          .close(sessionId)
          .catch((error) =>
            logger.warn(
              { errorCode: logErrorCode(error, 'BROWSER_SESSION_CLEANUP_FAILED'), sessionId, runId: context.runId },
              'Agent Browser stale session cleanup failed',
            ),
          );
        throw new Error('BROWSER_WORKSPACE_STALE');
      }
      return { session, binding };
    }
    if (session.generation !== null) throw new Error('BROWSER_WORKSPACE_BINDING_INVALID');
    let binding: ResolvedBrowserBinding;
    try {
      binding = await this.standaloneBinding(context, session.targetId);
    } catch (error) {
      if (error instanceof Error && error.message === 'BROWSER_TARGET_NOT_FOUND') {
        await this.gateway.close(sessionId).catch((closeError) =>
          logger.warn(
            {
              errorCode: logErrorCode(closeError, 'BROWSER_SESSION_CLEANUP_FAILED'),
              sessionId,
              runId: context.runId,
            },
            'Agent Browser missing-target session cleanup failed',
          ),
        );
        throw new Error('BROWSER_TARGET_STALE');
      }
      throw error;
    }
    if (binding.target.configurationHash !== session.targetConfigurationHash) {
      await this.gateway.close(sessionId).catch((error) =>
        logger.warn(
          {
            errorCode: logErrorCode(error, 'BROWSER_SESSION_CLEANUP_FAILED'),
            sessionId,
            runId: context.runId,
          },
          'Agent Browser stale-target session cleanup failed',
        ),
      );
      throw new Error('BROWSER_TARGET_STALE');
    }
    return { session, binding };
  }

  async revalidateCreate(context: ToolContext, args: Record<string, JsonValue>): Promise<ResolvedBrowserBinding> {
    const targetId = browserToolString(args.targetId, MAX_ID_BYTES);
    const targetRevision = browserToolInteger(args.targetRevision, 0, 1, Number.MAX_SAFE_INTEGER);
    const binding = args.workspaceId
      ? await this.workspaceBinding(context, browserToolString(args.workspaceId, MAX_ID_BYTES))
      : await this.standaloneBinding(context, targetId);
    if (
      binding.target.id !== targetId ||
      binding.target.profileRevision !== targetRevision ||
      binding.target.configurationHash !== browserToolString(args.targetConfigurationHash, 96)
    ) {
      throw new Error('RESOURCE_CHANGED');
    }
    if (
      binding.workspace &&
      binding.workspace.generation !== browserToolInteger(args.generation, 0, 1, Number.MAX_SAFE_INTEGER)
    ) {
      throw new Error('RESOURCE_CHANGED');
    }
    return binding;
  }

  inspection(
    context: ToolContext,
    name: string,
    normalizedArguments: JsonValue,
    binding: ResolvedBrowserBinding,
    sessionId: string | undefined,
    risk: 'read' | 'control' | 'mutate',
    mutation: boolean,
    policyRevision: number,
  ): ToolInspection {
    const target = this.toolTarget(binding, sessionId);
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
        this.cryptoHash,
      ),
      operationHashVersion: 1,
      preconditions,
      policyRevision,
      inputRevision: context.inputRevision,
    };
  }

  private toolTarget(binding: ResolvedBrowserBinding, sessionId?: string): ToolInspection['target'] {
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
        this.cryptoHash,
      ),
    };
  }
}
