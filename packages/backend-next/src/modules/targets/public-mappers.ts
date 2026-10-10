import type {
	ConnectionImport as PublicImport,
	ConnectionMetadata as PublicMetadata,
	ConnectionMutation as PublicConnectionMutation,
	ConnectionSnapshot as PublicSnapshot,
	CredentialMutation as PublicCredentialMutation,
	ImportItemResult,
	ProxyInput,
	ProxyMutation as PublicProxyMutation,
	ProxyUpdateInput,
	ProxyView,
	SshCredentialInput as PublicCredentialInput,
	SshKeyChanges as PublicKeyChanges,
	SshKeyInput as PublicKeyInput,
	SshKeyMutation as PublicKeyMutation,
	SshKeyView,
	TagMutation as PublicTagMutation,
	TagView,
	TrustedResolvedSshTarget,
	TrustedSshAuthentication,
	TrustedSshProxy,
	HostKeyTrustView,
} from './public.js';
import type { HostKeyTrust } from './host-keys/model/host-key-types.js';

export function toHostKeyView(value: HostKeyTrust): HostKeyTrustView {
	return {
		host: value.host,
		port: value.port,
		fingerprint: value.fingerprint,
		confirmedAt: value.confirmedAt,
	};
}
import type {
	ConnectionMetadata as InternalMetadata,
	ConnectionMutation as InternalConnectionMutation,
	ConnectionSnapshot as InternalSnapshot,
} from './connections/model/connection-types.js';
import type {
	ConnectionImport as InternalImport,
	ImportItemResult as InternalImportItemResult,
} from './import/model/import-types.js';
import type {
	SshCredentialInput as InternalCredentialInput,
	CredentialMutation as InternalCredentialMutation,
} from './connections/model/connection-credential-types.js';
import type {
	ProxyInput as InternalProxyInput,
	ProxyChanges as InternalProxyChanges,
	ProxySnapshot,
	ProxyMutation,
} from './proxies/model/proxy-types.js';
import type { TagSnapshot, TagMutation } from './tags/model/tag-types.js';
import type { SshKeySnapshot, SshKeyMutation } from './ssh-keys/model/ssh-key-types.js';
import type {
	SshKeyInput as InternalKeyInput,
	SshKeyChanges as InternalKeyChanges,
} from './ssh-keys/model/ssh-key-types.js';
import type { ResolvedSshTarget } from './resolver/model/ssh-target-types.js';

/** All projections are allowlists. Never spread an internal object through this boundary. */
export function toConnectionInput(input: PublicMetadata): InternalMetadata {
	return {
		name: input.name,
		type: input.type,
		host: input.host,
		port: input.port,
		username: input.username,
		route: input.route,
		proxyId: input.proxyId,
		notes: input.notes,
		rdpRemoteApp: input.rdpRemoteApp,
		rdpRemoteAppDirectory: input.rdpRemoteAppDirectory,
		rdpRemoteAppArguments: input.rdpRemoteAppArguments,
		tagIds: [...input.tagIds],
		jumpIds: [...input.jumpIds],
	};
}

export function toConnectionPatch(input: Partial<PublicMetadata>): Partial<InternalMetadata> {
	const result: Partial<InternalMetadata> = {};
	if (input.name !== undefined) {
		result.name = input.name;
	}
	if (input.type !== undefined) {
		result.type = input.type;
	}
	if (input.host !== undefined) {
		result.host = input.host;
	}
	if (input.port !== undefined) {
		result.port = input.port;
	}
	if (input.username !== undefined) {
		result.username = input.username;
	}
	if (input.route !== undefined) {
		result.route = input.route;
	}
	if (input.proxyId !== undefined) {
		result.proxyId = input.proxyId;
	}
	if (input.notes !== undefined) {
		result.notes = input.notes;
	}
	if (input.rdpRemoteApp !== undefined) {
		result.rdpRemoteApp = input.rdpRemoteApp;
	}
	if (input.rdpRemoteAppDirectory !== undefined) {
		result.rdpRemoteAppDirectory = input.rdpRemoteAppDirectory;
	}
	if (input.rdpRemoteAppArguments !== undefined) {
		result.rdpRemoteAppArguments = input.rdpRemoteAppArguments;
	}
	if (input.tagIds !== undefined) {
		result.tagIds = [...input.tagIds];
	}
	if (input.jumpIds !== undefined) {
		result.jumpIds = [...input.jumpIds];
	}
	return result;
}

export function toConnectionView(record: InternalSnapshot): PublicSnapshot {
	return {
		id: record.id,
		version: record.version,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
		name: record.name,
		type: record.type,
		host: record.host,
		port: record.port,
		username: record.username,
		route: record.route,
		proxyId: record.proxyId,
		notes: record.notes,
		rdpRemoteApp: record.rdpRemoteApp,
		rdpRemoteAppDirectory: record.rdpRemoteAppDirectory,
		rdpRemoteAppArguments: record.rdpRemoteAppArguments,
		tagIds: [...record.tagIds],
		jumpIds: [...record.jumpIds],
	};
}

export function toConnectionMutation(result: InternalConnectionMutation): PublicConnectionMutation {
	if (result.status === 'updated') {
		return { status: 'updated', value: toConnectionView(result.value) };
	}
	if (result.status === 'not_found') {
		return { status: 'not_found' };
	}
	return { status: 'version_conflict' };
}

export function toImportInput(command: PublicImport): InternalImport {
	const result: InternalImport = { connection: toConnectionInput(command.connection) };
	if (command.inlineProxy !== undefined) {
		const proxy = command.inlineProxy;
		result.inlineProxy = {
			name: proxy.name,
			type: proxy.type,
			host: proxy.host,
			port: proxy.port,
			username: proxy.username,
		};
	}
	if (command.tagNames !== undefined) {
		result.tagNames = [...command.tagNames];
	}
	return result;
}

export function toImportItems(results: readonly InternalImportItemResult[]): ImportItemResult[] {
	return results.map((result) =>
		result.status === 'ok' ? { status: 'ok', id: result.id } : { status: 'error', code: result.code },
	);
}

export function toProxyInput(input: ProxyInput): InternalProxyInput {
	const result: InternalProxyInput = {
		name: input.name,
		type: input.type,
		host: input.host,
		port: input.port,
		username: input.username,
	};
	if (input.password !== undefined) {
		result.password = input.password;
	}
	return result;
}

export function toProxyPatch(input: ProxyUpdateInput): InternalProxyChanges {
	const result: InternalProxyChanges = {};
	if (input.name !== undefined) {
		result.name = input.name;
	}
	if (input.type !== undefined) {
		result.type = input.type;
	}
	if (input.host !== undefined) {
		result.host = input.host;
	}
	if (input.port !== undefined) {
		result.port = input.port;
	}
	if (input.username !== undefined) {
		result.username = input.username;
	}
	if (input.password !== undefined) {
		result.password = input.password;
	}
	return result;
}

export function toProxyView(record: ProxySnapshot): ProxyView {
	return {
		id: record.id,
		name: record.name,
		type: record.type,
		host: record.host,
		port: record.port,
		username: record.username,
		version: record.version,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
	};
}

export function toProxyMutation(result: ProxyMutation): PublicProxyMutation {
	if (result.status === 'updated') {
		return { status: 'updated', value: toProxyView(result.value) };
	}
	if (result.status === 'not_found') {
		return { status: 'not_found' };
	}
	return { status: 'version_conflict' };
}

export function toTagView(record: TagSnapshot): TagView {
	return {
		id: record.id,
		name: record.name,
		version: record.version,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
	};
}

export function toTagMutation(result: TagMutation): PublicTagMutation {
	if (result.status === 'updated') {
		return { status: 'updated', value: toTagView(result.value) };
	}
	if (result.status === 'not_found') {
		return { status: 'not_found' };
	}
	return { status: 'version_conflict' };
}

export function toSshKeyInput(input: PublicKeyInput): InternalKeyInput {
	const result: InternalKeyInput = { name: input.name, privateKey: input.privateKey };
	if (input.passphrase !== undefined) {
		result.passphrase = input.passphrase;
	}
	return result;
}

export function toSshKeyPatch(input: PublicKeyChanges): InternalKeyChanges {
	const result: InternalKeyChanges = {};
	if (input.name !== undefined) {
		result.name = input.name;
	}
	if (input.privateKey !== undefined) {
		result.privateKey = input.privateKey;
	}
	if (input.passphrase !== undefined) {
		result.passphrase = input.passphrase;
	}
	return result;
}

export function toSshKeyView(record: SshKeySnapshot): SshKeyView {
	return {
		id: record.id,
		name: record.name,
		version: record.version,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
	};
}

export function toSshKeyMutation(result: SshKeyMutation): PublicKeyMutation {
	if (result.status === 'updated') {
		return { status: 'updated', value: toSshKeyView(result.value) };
	}
	if (result.status === 'not_found') {
		return { status: 'not_found' };
	}
	return { status: 'version_conflict' };
}

export function toCredentialInput(input: PublicCredentialInput): InternalCredentialInput {
	if (input.kind === 'password') {
		return { kind: 'password', password: input.password };
	}
	return { kind: 'ssh_key', sshKeyId: input.sshKeyId };
}

export function toCredentialMutation(result: InternalCredentialMutation): PublicCredentialMutation {
	if (result.status === 'updated') {
		return { status: 'updated' };
	}
	if (result.status === 'not_found') {
		return { status: 'not_found' };
	}
	return { status: 'version_conflict' };
}

export function toTrustedTargetView(record: ResolvedSshTarget): TrustedResolvedSshTarget {
	const auth = record.authentication;
	const authentication: TrustedSshAuthentication =
		auth.kind === 'password'
			? { kind: 'password', password: auth.password }
			: { kind: 'ssh_key', privateKey: auth.privateKey, passphrase: auth.passphrase };
	const proxy = record.proxy;
	const targetProxy: TrustedSshProxy | null =
		proxy === null
			? null
			: {
					type: proxy.type,
					host: proxy.host,
					port: proxy.port,
					username: proxy.username,
					password: proxy.password,
				};
	const jumps = record.jumps.map((jump) => toTrustedTargetView(jump));
	return Object.freeze({
		id: record.id,
		host: record.host,
		port: record.port,
		username: record.username,
		authentication: Object.freeze(authentication),
		proxy: targetProxy === null ? null : Object.freeze(targetProxy),
		jumps: Object.freeze(jumps),
		fingerprint: record.fingerprint,
	});
}
