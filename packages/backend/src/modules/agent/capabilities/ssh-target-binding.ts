import type { SshTargetResolverPort } from './ssh-target-resolver.port';
import type { AgentTargetSelector, CanonicalToolTargetFingerprint, ToolTargetFingerprint } from './tool-target.types';
import type { ToolContext, ToolPrecondition } from './tool.types';

export interface ResolvedSshTarget {
  selector: { target: 'ssh'; id: string };
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

const resolved = (fingerprint: CanonicalToolTargetFingerprint, connectionId: number): ResolvedSshTarget => ({
  selector: { target: 'ssh', id: String(connectionId) },
  fingerprint,
  resourceKeys: [`connection:${connectionId}`],
  preconditions: [],
  connectionId,
});

/** Resolve a selected SSH connection. Never fall back to local or Workspace execution. */
export const resolveSshTarget = async (
  targets: SshTargetResolverPort,
  context: ToolContext,
  selector: AgentTargetSelector,
): Promise<ResolvedSshTarget> => {
  if (selector.target !== 'ssh') throw new Error('TOOL_ARGUMENTS_INVALID');
  const connectionId = sshConnectionId(selector.id);
  return resolved(await targets.target(context, connectionId), connectionId);
};

/** Restore an inspected SSH target without trusting a forged kind or connection ID. */
export const bindSshInspectionTarget = (fingerprint: ToolTargetFingerprint): ResolvedSshTarget => {
  if (
    fingerprint.kind !== 'ssh' ||
    fingerprint.target !== 'ssh' ||
    !Number.isSafeInteger(fingerprint.connectionId) ||
    (fingerprint.connectionId ?? 0) < 1 ||
    fingerprint.id !== String(fingerprint.connectionId)
  ) {
    throw new Error('TOOL_STATE_CONFLICT');
  }
  return resolved(fingerprint, fingerprint.connectionId!);
};
