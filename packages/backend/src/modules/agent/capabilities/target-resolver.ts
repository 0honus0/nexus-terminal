import type { JsonValue } from '../agent.types';
import type { CryptoHashPort } from '../crypto-hash.port';
import { hashOperation } from '../operation-hash';
import type { AgentWorkspaceRepositoryPort } from '../workspace-runtime/workspace-runtime.repository.port';
import type { SshTargetResolverPort } from './ssh-target-resolver.port';
import type { AgentTargetSelector, CanonicalToolTargetFingerprint } from './tool-target.types';
import type { ToolContext, ToolPrecondition } from './tool.types';

export interface ResolvedAgentTarget {
  selector: AgentTargetSelector;
  fingerprint: CanonicalToolTargetFingerprint;
  resourceKeys: string[];
  preconditions: ToolPrecondition[];
  workspaceGeneration?: number;
  connectionId?: number;
}

export interface ResolveAgentTargetOptions {
  requireRunningWorkspace?: boolean;
}

const sshConnectionId = (id: string): number => {
  if (!/^[1-9][0-9]*$/.test(id)) throw new Error('TOOL_ARGUMENTS_INVALID');
  const connectionId = Number(id);
  if (!Number.isSafeInteger(connectionId)) throw new Error('TOOL_ARGUMENTS_INVALID');
  return connectionId;
};

export class AgentTargetResolver {
  constructor(
    private readonly workspaces: AgentWorkspaceRepositoryPort,
    private readonly sshTargets: SshTargetResolverPort,
    private readonly cryptoHash: CryptoHashPort,
  ) {}

  async resolve(
    context: ToolContext,
    selector: AgentTargetSelector,
    options: ResolveAgentTargetOptions = {},
  ): Promise<ResolvedAgentTarget> {
    if (selector.target === 'ssh') return this.resolveSsh(context, selector);
    return this.resolveWorkspace(context, selector, options);
  }

  private async resolveWorkspace(
    context: ToolContext,
    selector: AgentTargetSelector,
    options: ResolveAgentTargetOptions,
  ): Promise<ResolvedAgentTarget> {
    if (!selector.id || selector.id.length > 128) throw new Error('TOOL_ARGUMENTS_INVALID');
    const workspace = await this.workspaces.getWorkspace(context, selector.id);
    if (!workspace) throw new Error('NOT_FOUND');
    if (workspace.runId !== context.runId || workspace.agentRuntimeId !== context.agentRuntimeId) {
      throw new Error('RESOURCE_FORBIDDEN');
    }
    if ((options.requireRunningWorkspace ?? true) && workspace.status !== 'running') {
      throw new Error('WORKSPACE_NOT_RUNNING');
    }
    const fingerprint: CanonicalToolTargetFingerprint = {
      kind: 'workspace',
      target: 'workspace',
      id: workspace.id,
      workspaceId: workspace.id,
      generation: workspace.generation,
      targetIdentity: `workspace:${workspace.id}:${workspace.generation}`,
      endpoint: `workspace:${workspace.id}`,
      loginUser: 'runner:65532',
      configurationHash: hashOperation(
        {
          schemaVersion: 2,
          workspaceId: workspace.id,
          generation: workspace.generation,
          profile: JSON.parse(JSON.stringify(workspace.profile)) as JsonValue,
        },
        this.cryptoHash,
      ),
    };
    return {
      selector: { target: 'workspace', id: workspace.id },
      fingerprint,
      resourceKeys: [`workspace:${workspace.id}:${workspace.generation}`],
      preconditions: [
        {
          kind: 'workspaceGeneration',
          key: workspace.id,
          observedValue: {
            generation: workspace.generation,
            version: workspace.version,
            status: workspace.status,
          },
        },
      ],
      workspaceGeneration: workspace.generation,
    };
  }

  private async resolveSsh(context: ToolContext, selector: AgentTargetSelector): Promise<ResolvedAgentTarget> {
    const connectionId = sshConnectionId(selector.id);
    const fingerprint = await this.sshTargets.target(context, connectionId);
    return {
      selector: { target: 'ssh', id: String(connectionId) },
      fingerprint,
      resourceKeys: [`connection:${connectionId}`],
      preconditions: [],
      connectionId,
    };
  }
}
