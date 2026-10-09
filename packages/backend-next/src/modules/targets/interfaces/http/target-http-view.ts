import type {
	ConnectionSnapshot,
	ConnectionMutation,
	CredentialMutation,
	ImportItemResult,
	ProxyView,
	ProxyMutation,
	TagView,
	TagMutation,
	SshKeyView,
	SshKeyMutation,
} from '../../public.js';
import type { TargetConnectionView } from '@nexus-terminal/shared/connections/model';
import type {
	TargetConnectionMutation,
	TargetCredentialMutation,
	TargetImportItem,
} from '@nexus-terminal/shared/connections/api';
import type { TargetProxyView } from '@nexus-terminal/shared/proxies/model';
import type { TargetProxyMutation } from '@nexus-terminal/shared/proxies/api';
import type { TargetTagView } from '@nexus-terminal/shared/tags/model';
import type { TargetTagMutation } from '@nexus-terminal/shared/tags/api';
import type { TargetSshKeyView } from '@nexus-terminal/shared/ssh-keys/model';
import type { TargetSshKeyMutation } from '@nexus-terminal/shared/ssh-keys/api';

/** Explicit wire allowlists: no Service, Storage, or trusted SSH object escapes. */
export function toConnectionDto(value: ConnectionSnapshot): TargetConnectionView {
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
		rdpRemoteApp: value.rdpRemoteApp,
		rdpRemoteAppDirectory: value.rdpRemoteAppDirectory,
		rdpRemoteAppArguments: value.rdpRemoteAppArguments,
		tagIds: value.tagIds.map((id) => id),
		jumpIds: value.jumpIds.map((id) => id),
	};
}

export function toConnectionMutation(value: ConnectionMutation): TargetConnectionMutation {
	if (value.status === 'updated') return { status: 'updated', value: toConnectionDto(value.value) };
	return { status: value.status };
}

export function toProxyDto(value: ProxyView): TargetProxyView {
	return {
		id: value.id,
		name: value.name,
		type: value.type,
		host: value.host,
		port: value.port,
		username: value.username,
		version: value.version,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

export function toProxyMutation(value: ProxyMutation): TargetProxyMutation {
	if (value.status === 'updated') return { status: 'updated', value: toProxyDto(value.value) };
	return { status: value.status };
}

export function toTagDto(value: TagView): TargetTagView {
	return {
		id: value.id,
		name: value.name,
		version: value.version,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

export function toTagMutation(value: TagMutation): TargetTagMutation {
	if (value.status === 'updated') return { status: 'updated', value: toTagDto(value.value) };
	return { status: value.status };
}

export function toSshKeyDto(value: SshKeyView): TargetSshKeyView {
	return {
		id: value.id,
		name: value.name,
		version: value.version,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

export function toSshKeyMutation(value: SshKeyMutation): TargetSshKeyMutation {
	if (value.status === 'updated') return { status: 'updated', value: toSshKeyDto(value.value) };
	return { status: value.status };
}

export function toCredentialMutation(value: CredentialMutation): TargetCredentialMutation {
	return { status: value.status };
}

export function toImportItems(items: readonly ImportItemResult[]): TargetImportItem[] {
	return items.map((item) =>
		item.status === 'ok' ? { status: 'ok', id: item.id } : { status: 'error', code: item.code },
	);
}
