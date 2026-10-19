import type { AccessPasskeySummary } from '@nexus-terminal/shared/access/factors/http';
import type { PasskeySummary } from './security-types';

export function toPasskeySummary(value: AccessPasskeySummary): PasskeySummary {
	return {
		credentialId: value.credentialId,
		name: value.name,
		transports: value.transports.map((entry) => entry),
		createdAtMs: value.createdAt * 1000,
		lastUsedAtMs: value.lastUsedAt === null ? null : value.lastUsedAt * 1000,
	};
}
