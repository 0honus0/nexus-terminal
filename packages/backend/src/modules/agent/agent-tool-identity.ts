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

export function isAcpPermissionIdentity(value: AgentToolIdentity): boolean {
	return value.kind === 'host' && value.operation === 'acp.permission';
}

export function sameToolIdentity(a: AgentToolIdentity, b: AgentToolIdentity): boolean {
	return JSON.stringify(copyToolIdentity(a)) === JSON.stringify(copyToolIdentity(b));
}
