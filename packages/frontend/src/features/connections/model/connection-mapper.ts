import type { TargetConnectionView, TargetCredentialView } from '@nexus-terminal/shared/targets/connections/model';
import type { TargetConnectionInput, TargetCredentialInput } from '@nexus-terminal/shared/targets/connections/http';
import { readConnectionInput, readCredentialInput } from '@nexus-terminal/shared/targets/connections/http-codec';
import type { UnsavedSshTestInput } from '@nexus-terminal/shared/targets/connections/test-http';
import { readUnsavedSshTest } from '@nexus-terminal/shared/targets/connections/test-codec';
import type { ConnectionDraft, ConnectionSummary, CredentialSummary } from './connection-types';

export function toConnectionSummary(value: TargetConnectionView): ConnectionSummary {
	return {
		id: value.id,
		version: value.version,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
		name: value.name,
		type: value.type,
		host: value.host,
		port: value.port,
		username: value.username,
		route: value.route,
		proxyId: value.proxyId,
		notes: value.notes,
		tagIds: value.tagIds.map((id) => id),
		jumpIds: value.jumpIds.map((id) => id),
		lastConnectedAt: value.lastConnectedAt,
	};
}

export function toConnectionDraft(value: ConnectionSummary | null): ConnectionDraft {
	return {
		name: value?.name ?? '',
		type: value?.type ?? 'SSH',
		host: value?.host ?? '',
		port: value?.port ?? 22,
		username: value?.username ?? '',
		authMethod: 'password',
		password: '',
		sshKeyId: null,
		proxyId: value?.proxyId ?? null,
		route: value?.route ?? 'direct',
		tagIds: value?.tagIds.map((id) => id) ?? [],
		notes: value?.notes ?? '',
		jumpIds: value?.jumpIds.map((id) => id) ?? [],
	};
}

export function toConnectionInput(value: ConnectionDraft): TargetConnectionInput {
	return readConnectionInput({
		name: value.name.trim() || value.host.trim(),
		type: value.type,
		host: value.host.trim(),
		port: Number(value.port),
		username: value.username.trim(),
		route: value.route,
		proxyId: value.route === 'proxy' ? value.proxyId : null,
		notes: value.notes || null,
		tagIds: value.tagIds.map((id) => id),
		jumpIds: value.route === 'jump' ? value.jumpIds.map((id) => id) : [],
	});
}

export function toConnectionCredential(value: ConnectionDraft): TargetCredentialInput {
	return readCredentialInput(
		value.type === 'SSH' && value.authMethod === 'key'
			? { kind: 'ssh_key', sshKeyId: value.sshKeyId }
			: { kind: 'password', password: value.password },
	);
}

export function toUnsavedTest(value: ConnectionDraft): UnsavedSshTestInput {
	return readUnsavedSshTest({
		host: value.host.trim(),
		port: Number(value.port),
		username: value.username.trim(),
		authentication:
			value.authMethod === 'key'
				? { kind: 'ssh_key', sshKeyId: value.sshKeyId }
				: { kind: 'password', password: value.password },
		route: value.route,
		proxyId: value.route === 'proxy' ? value.proxyId : null,
		jumpIds: value.route === 'jump' ? value.jumpIds.map((id) => id) : [],
	});
}

export function toCredentialSummary(value: TargetCredentialView): CredentialSummary {
	const credential: CredentialSummary['credential'] =
		value.credential.kind === 'ssh_key'
			? { kind: 'ssh_key', sshKeyId: value.credential.sshKeyId }
			: { kind: value.credential.kind };
	return { connectionId: value.connectionId, version: value.version, credential };
}
