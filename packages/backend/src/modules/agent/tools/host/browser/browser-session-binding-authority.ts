import { logErrorCode, logger } from '../../../../../shared/logging/logger';
import type { JsonValue } from '../../../agent.types';
import type { BrowserGatewayPort, BrowserSessionView, BrowserTargetSnapshot } from '../../../ai/integrations.types';
import type { ToolContext, ToolInspection, ToolPrecondition } from '../../../capabilities/tool.types';
import type { CryptoHashPort } from '../../../crypto-hash.port';
import type { AgentSettingsService } from '../../../host/agent-settings.service';
import { hashOperation } from '../../../operation-hash';
import { MAX_ID_BYTES, TOOL_VERSION, browserToolInteger, browserToolString } from './browser-tool-common';

export interface ResolvedBrowserBinding {
  target: BrowserTargetSnapshot;
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
    private readonly settings: AgentSettingsService,
    private readonly gateway: BrowserGatewayPort,
    private readonly cryptoHash: CryptoHashPort,
  ) {}

  async createBinding(context: ToolContext, args: Record<string, JsonValue>): Promise<ResolvedBrowserBinding> {
    if (args.workspaceId !== undefined) throw new Error('BROWSER_TARGET_SELECTION_INVALID');
    return this.targetBinding(context, browserToolString(args.targetId, MAX_ID_BYTES));
  }

  async targetBinding(context: ToolContext, targetId: string): Promise<ResolvedBrowserBinding> {
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
    let binding: ResolvedBrowserBinding;
    try {
      binding = await this.targetBinding(context, session.targetId);
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
    if (
      binding.target.id !== session.targetId ||
      binding.target.profileRevision !== session.targetRevision ||
      binding.target.configurationHash !== session.targetConfigurationHash
    ) {
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
    if (args.workspaceId !== undefined || args.generation !== undefined) {
      throw new Error('BROWSER_TARGET_SELECTION_INVALID');
    }
    const binding = await this.targetBinding(context, targetId);
    if (
      binding.target.id !== targetId ||
      binding.target.profileRevision !== targetRevision ||
      binding.target.configurationHash !== browserToolString(args.targetConfigurationHash, 96)
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
      ...(sessionId ? [`browser:${sessionId}`] : []),
    ];
    const preconditions: ToolPrecondition[] = [
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
    const target = binding.target;
    return {
      kind: 'browser',
      ...(sessionId ? { browserSessionId: sessionId } : {}),
      targetIdentity: ['browser', target.id, target.configurationHash, target.profileRevision, sessionId ?? 'new'].join(
        ':',
      ),
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
        },
        this.cryptoHash,
      ),
    };
  }
}
