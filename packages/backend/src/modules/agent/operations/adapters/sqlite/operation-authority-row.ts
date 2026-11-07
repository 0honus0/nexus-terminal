import { isAgentRecord } from '@nexus-terminal/shared/agent/http-codec';
import type { StoredOperationDispatchAuthority } from '../../storage/operation-storage.js';

function row(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (
		!isAgentRecord(value) ||
		Object.keys(value).length !== keys.length ||
		!keys.every((key) => Object.hasOwn(value, key))
	) {
		throw new Error('Invalid stored operation authority');
	}
	return value;
}

function integer(value: unknown, min = 1): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
		throw new Error('Invalid stored operation authority revision');
	}
	return value;
}

function text(value: unknown): string {
	if (typeof value !== 'string' || !value) {
		throw new Error('Invalid stored operation authority identity');
	}
	return value;
}

function participant(input: unknown): StoredOperationDispatchAuthority['instance'] {
	const value = row(input, ['id', 'packageId', 'generation', 'configurationRevision', 'packageRevision']);
	return {
		id: text(value.id),
		packageId: text(value.packageId),
		generation: text(value.generation),
		configurationRevision: integer(value.configurationRevision, 0),
		packageRevision: integer(value.packageRevision),
	};
}

export function operationAuthority(json: unknown): StoredOperationDispatchAuthority {
	const value = row(JSON.parse(text(json)), [
		'policyRevision',
		'policyExecutionVersion',
		'denylistRevision',
		'settingsVersion',
		'instance',
		'ancestors',
		'provider',
		'target',
		'modelReservation',
		'approval',
	]);
	if (!Array.isArray(value.ancestors)) {
		throw new Error('Invalid stored operation authority ancestry');
	}
	const provider = value.provider === null ? null : row(value.provider, ['id', 'version', 'credentialRevision']);
	const target = value.target === null ? null : row(value.target, ['id', 'version']);
	const reservation = value.modelReservation === null ? null : row(value.modelReservation, ['tokens']);
	const approval = value.approval === null ? null : row(value.approval, ['id', 'version']);
	return {
		policyRevision: integer(value.policyRevision),
		policyExecutionVersion: integer(value.policyExecutionVersion, 0),
		denylistRevision: integer(value.denylistRevision),
		settingsVersion: integer(value.settingsVersion),
		instance: participant(value.instance),
		ancestors: value.ancestors.map(participant),
		provider:
			provider === null
				? null
				: {
						id: text(provider.id),
						version: integer(provider.version),
						credentialRevision: integer(provider.credentialRevision, 0),
					},
		target: target === null ? null : { id: integer(target.id), version: integer(target.version) },
		modelReservation: reservation === null ? null : { tokens: integer(reservation.tokens) },
		approval: approval === null ? null : { id: text(approval.id), version: integer(approval.version) },
	};
}
