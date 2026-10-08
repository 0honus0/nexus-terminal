import type { SshTargetResolverPort } from './ssh-target-resolver.port';
import type { AgentTargetSelector, CanonicalToolTargetFingerprint } from './tool-target.types';
import type { ToolContext, ToolPrecondition } from './tool.types';

export interface ResolvedAgentTarget {
  selector: AgentTargetSelector & { target: 'ssh' };
  fingerprint: CanonicalToolTargetFingerprint;
  resourceKeys: string[];
  preconditions: ToolPrecondition[];
  connectionId: number;
}

const sshConnectionId = (id: string): number => {
  if (!/^[1-9][0-9]*$/.test(id)) throw new Error('TOOL_ARGUMENTS_INVALID');
  const connectionId = Number(id);
  if (!Number.isSafeInteger(connectionId)) throw new Error('TOOL_ARGUMENTS_INVALID');
  return connectionId;
};

/** File, Shell and ACP use SSH only; Browser has a separate target-binding authority. */
export class AgentTargetResolver {
  constructor(private readonly sshTargets: SshTargetResolverPort) {}

  async resolve(context: ToolContext, selector: AgentTargetSelector): Promise<ResolvedAgentTarget> {
    if (selector.target !== 'ssh') throw new Error('TOOL_ARGUMENTS_INVALID');
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
