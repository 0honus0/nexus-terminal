import type { AgentToolIdentity } from '@nexus-terminal/shared/agent/tools/identity';

/** Whitelist the immutable provenance value at application, storage, and public boundaries. */
export function copyToolIdentity(value: AgentToolIdentity): AgentToolIdentity {
	return value.kind === 'host'
		? { kind: 'host', operation: value.operation }
		: {
				kind: 'plugin',
				packageId: value.packageId,
				packageVersion: value.packageVersion,
				packageSha256: value.packageSha256,
				name: value.name,
			};
}
