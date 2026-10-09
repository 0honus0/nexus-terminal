import type { SqliteRuntime } from '../../platform/storage/sqlite/sqlite-runtime.js';
import type { SecretBox } from '../../platform/security/secret-box.js';
import {
	ConnectionSqliteAdapter,
	insertConnectionInTransaction,
} from './connections/adapters/sqlite/connection-sql.js';
import { SqliteConnectionCredentialStorage } from './connections/adapters/sqlite/connection-credential-sql.js';
import { ConnectionCredentialModel } from './connections/model/connection-credential-model.js';
import { ConnectionCredentialService } from './connections/service/connection-credential-service.js';
import { ConnectionModel } from './connections/model/connection-model.js';
import { ConnectionService } from './connections/service/connection-service.js';
import { findOrCreateProxy } from './proxies/adapters/sqlite/proxy-sql.js';
import { SqliteProxyStorage } from './proxies/adapters/sqlite/proxy-management-sql.js';
import { ProxyModel } from './proxies/model/proxy-model.js';
import { ProxyService } from './proxies/service/proxy-service.js';
import { findOrCreateTag } from './tags/adapters/sqlite/tag-sql.js';
import { SqliteTagStorage } from './tags/adapters/sqlite/tag-management-sql.js';
import { TagModel } from './tags/model/tag-model.js';
import { TagService } from './tags/service/tag-service.js';
import { SqliteSshKeyStorage } from './ssh-keys/adapters/sqlite/ssh-key-sql.js';
import { SshKeyModel } from './ssh-keys/model/ssh-key-model.js';
import { SshKeyService } from './ssh-keys/service/ssh-key-service.js';
import { SqliteConnectionImportAdapter } from './import/adapters/sqlite/import-sql.js';
import { ConnectionImportModel } from './import/model/import-model.js';
import { ConnectionImportService } from './import/service/connection-import-service.js';
import { SqliteSshTargetStorage } from './resolver/adapters/sqlite/ssh-target-sql.js';
import { SshTargetModel } from './resolver/model/ssh-target-model.js';
import { SshTargetService } from './resolver/service/ssh-target-service.js';
import type { TargetsPublicApi, TrustedSshTargetResolver } from './public.js';
import {
	connectionInput,
	connectionPatch,
	connectionView,
	connectionMutation,
	importInput,
	importItems,
	proxyInput,
	proxyPatch,
	proxyView,
	proxyMutation,
	tagView,
	tagMutation,
	sshKeyInput,
	sshKeyPatch,
	sshKeyView,
	sshKeyMutation,
	credentialInput,
	credentialMutation,
	trustedTargetView,
} from './public-mappers.js';

/** Register real internal owners; expose only explicit, allowlisted projections. */
export function registerTargets({ sqlite, secrets }: { sqlite: SqliteRuntime; secrets: SecretBox | null }): {
	publicApi: TargetsPublicApi;
	trustedSshTargets: TrustedSshTargetResolver;
} {
	const model = new ConnectionModel(new ConnectionSqliteAdapter(sqlite));
	const service = new ConnectionService(model);
	const imports = new SqliteConnectionImportAdapter(sqlite, {
		connections: { insert: insertConnectionInTransaction },
		proxies: { findOrCreate: findOrCreateProxy },
		tags: { findOrCreate: findOrCreateTag },
	});
	const importService = new ConnectionImportService(new ConnectionImportModel(imports));
	const proxies = new ProxyService(new ProxyModel(new SqliteProxyStorage(sqlite)), secrets);
	const tags = new TagService(new TagModel(new SqliteTagStorage(sqlite)));
	const sshKeys = new SshKeyService(new SshKeyModel(new SqliteSshKeyStorage(sqlite)), secrets);
	const credentials = new ConnectionCredentialService(
		new ConnectionCredentialModel(new SqliteConnectionCredentialStorage(sqlite)),
		secrets,
	);
	const resolver = new SshTargetService(new SshTargetModel(new SqliteSshTargetStorage(sqlite)), secrets);

	const publicApi: TargetsPublicApi = {
		list: () => service.list().then((records) => records.map((record) => connectionView(record))),

		get: (id) => service.get(id).then((record) => (record === null ? null : connectionView(record))),

		create: (input) => service.create(connectionInput(input)).then(connectionView),

		update: (id, version, patch) => service.update(id, version, connectionPatch(patch)).then(connectionMutation),

		clone: (id, name) =>
			service.clone(id, name).then((record) => (record === null ? null : connectionView(record))),

		delete: (id) => service.delete(id).then((deleted) => Boolean(deleted)),

		setTags: (id, version, tagIds) =>
			service
				.setTags(
					id,
					version,
					tagIds.map((tagId) => tagId),
				)
				.then(connectionMutation),

		importOne: (command) => importService.importOne(importInput(command)).then(connectionView),

		importMany: (commands) =>
			importService.importMany(commands.map((command) => importInput(command))).then(importItems),

		proxies: {
			list: () => proxies.list().then((records) => records.map((record) => proxyView(record))),

			get: (id) => proxies.get(id).then((record) => (record === null ? null : proxyView(record))),

			create: (input) => proxies.create(proxyInput(input)).then(proxyView),

			update: (id, version, patch) => proxies.update(id, version, proxyPatch(patch)).then(proxyMutation),

			delete: (id) => proxies.delete(id).then((deleted) => Boolean(deleted)),
		},
		tags: {
			list: () => tags.list().then((records) => records.map((record) => tagView(record))),

			get: (id) => tags.get(id).then((record) => (record === null ? null : tagView(record))),

			create: (name) => tags.create(name).then(tagView),

			rename: (id, version, name) => tags.rename(id, version, name).then(tagMutation),

			delete: (id) => tags.delete(id).then((deleted) => Boolean(deleted)),
		},
		sshKeys: {
			list: () => sshKeys.list().then((records) => records.map((record) => sshKeyView(record))),

			get: (id) => sshKeys.get(id).then((record) => (record === null ? null : sshKeyView(record))),

			create: (input) => sshKeys.create(sshKeyInput(input)).then(sshKeyView),

			update: (id, version, patch) => sshKeys.update(id, version, sshKeyPatch(patch)).then(sshKeyMutation),

			delete: (id) => sshKeys.delete(id).then((deleted) => Boolean(deleted)),
		},
		credentials: {
			set: (id, version, input) => credentials.set(id, version, credentialInput(input)).then(credentialMutation),

			clear: (id, version) => credentials.clear(id, version).then(credentialMutation),
		},
	};

	const trustedSshTargets: TrustedSshTargetResolver = {
		fingerprintStored: (id) => resolver.fingerprintStored(id).then((value) => String(value)),

		resolveStored: (id) => resolver.resolveStored(id).then(trustedTargetView),
	};

	return { publicApi, trustedSshTargets };
}
