import { sshTargetIdentity } from '../../capabilities/ssh-target-identity';
import type { ToolInspection } from '../../capabilities/tool.types';
import { CapabilityRegistry } from '../../host/capability-registry';
import type { AgentCapability } from '../../host/capability.types';

const MUTATION_CAPABILITIES: Readonly<Record<string, AgentCapability>> = {
  file_write: 'file.write',
  file_patch: 'file.write',
  file_move: 'file.write',
  file_delete: 'file.delete',
  shell_execute: 'shell.execute',
};

const registry = new CapabilityRegistry();

/** Both the execution owner and StateCommit must prove the same frozen SSH delegation. */
export const governedSubagentSshMutation = (
  inspection: ToolInspection,
  selectedConnectionIds: readonly number[],
  delegatedGrants: unknown,
): boolean => {
  const capability = Object.prototype.hasOwnProperty.call(MUTATION_CAPABILITIES, inspection.toolName)
    ? MUTATION_CAPABILITIES[inspection.toolName]
    : undefined;
  const target = inspection.target;
  if (
    !capability ||
    !inspection.mutation ||
    !['mutate', 'destructive'].includes(inspection.risk) ||
    target.kind !== 'ssh' ||
    target.target !== 'ssh' ||
    !Number.isSafeInteger(target.connectionId) ||
    (target.connectionId ?? 0) < 1 ||
    target.id !== String(target.connectionId) ||
    !selectedConnectionIds.includes(target.connectionId!) ||
    !target.configurationHash ||
    !target.endpoint ||
    !target.loginUser ||
    target.hostKeyTrust !== 'unavailable' ||
    !Array.isArray(delegatedGrants) ||
    !inspection.normalizedArguments ||
    Array.isArray(inspection.normalizedArguments) ||
    typeof inspection.normalizedArguments !== 'object'
  ) {
    return false;
  }

  const args = inspection.normalizedArguments as Record<string, unknown>;
  if (args.target !== 'ssh' || args.id !== target.id) return false;

  // Bind the persisted snapshot to the actual SSH target fingerprint format.
  const identity = sshTargetIdentity(target.endpoint, target.loginUser, target.configurationHash);
  if (
    target.targetIdentity !== identity ||
    !inspection.resourceKeys.some(
      (key) => key === `connection:${target.connectionId}` || key.startsWith(`connection:${target.connectionId}:`),
    ) ||
    inspection.resourceKeys.some((key) => key.startsWith('workspace:'))
  ) {
    return false;
  }

  return delegatedGrants.some((value: unknown) => {
    if (!value || Array.isArray(value) || typeof value !== 'object') return false;
    const grant = value as Record<string, unknown>;
    if (grant.capability !== capability || grant.schemaVersion !== 2) return false;
    try {
      const scope = registry.parseScope(capability, grant.scope);
      return registry.allows(capability, scope, { target: 'ssh', id: target.id });
    } catch {
      return false;
    }
  });
};
