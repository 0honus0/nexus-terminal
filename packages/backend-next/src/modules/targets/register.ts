import { importConnections } from './import/connection-import-batch.js';
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
import { SqliteHostKeyStorage } from './host-keys/adapters/sqlite/host-key-sql.js';
import { HostKeyModel } from './host-keys/model/host-key-model.js';
import { HostKeyService } from './host-keys/service/host-key-service.js';
import type { TargetsPublicApi, TrustedSshTargetResolver } from './public.js';
import { targetsBoundary } from './target-errors.js';
import type { AccessPublicApi } from '../access/public.js';
import type { HttpRoute } from '../../platform/http/http-types.js';
import { createTargetsRoutes } from './interfaces/http/target-http.js';
import {
	toConnectionInput,
	toConnectionPatch,
	toConnectionView,
	toConnectionMutation,
	toImportInput,
	toImportItems,
	toProxyInput,
	toProxyPatch,
	toProxyView,
	toProxyMutation,
	toTagView,
	toTagMutation,
	toSshKeyInput,
	toSshKeyPatch,
	toSshKeyView,
	toSshKeyMutation,
	toCredentialInput,
	toCredentialMutation,
	toTrustedTargetView,
	toHostKeyView,
} from './public-mappers.js';

interface TargetsRegistrationOptions {
	sqlite: SqliteRuntime;
	secrets: SecretBox | null;
}

interface TargetsRegistration {
	publicApi: TargetsPublicApi;
	trustedSshTargets: TrustedSshTargetResolver;
	routes(access: AccessPublicApi): HttpRoute[];
}

/** Register real internal owners; expose only explicit, allowlisted projections. */
export function registerTargets({ sqlite, secrets }: TargetsRegistrationOptions): TargetsRegistration {
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
	const hostKeys = new HostKeyService(new HostKeyModel(new SqliteHostKeyStorage(sqlite)));

	const publicApi: TargetsPublicApi = {
		hostKeys: {
			list: () => targetsBoundary(async () => (await hostKeys.list()).map(toHostKeyView)),

			confirm: (input) =>
				targetsBoundary(async () => {
					const key = await hostKeys.confirm({
						host: input.host,
						port: input.port,
						fingerprint: input.fingerprint,
					});
					return toHostKeyView(key);
				}),

			remove: (host, port) => targetsBoundary(() => hostKeys.remove(host, port)),
		},

		list: () => targetsBoundary(async () => (await service.list()).map(toConnectionView)),

		get: (id) =>
			targetsBoundary(async () => {
				const record = await service.get(id);
				return record === null ? null : toConnectionView(record);
			}),

		create: (input) =>
			targetsBoundary(async () => toConnectionView(await service.create(toConnectionInput(input)))),

		update: (id, version, changes) =>
			targetsBoundary(async () =>
				toConnectionMutation(await service.update(id, version, toConnectionPatch(changes))),
			),

		clone: (id, name) =>
			targetsBoundary(async () => {
				const record = await service.clone(id, name);
				return record === null ? null : toConnectionView(record);
			}),

		delete: (id) => targetsBoundary(async () => Boolean(await service.delete(id))),

		setTags: (id, version, tagIds) =>
			targetsBoundary(async () => toConnectionMutation(await service.setTags(id, version, [...tagIds]))),

		importOne: (input) =>
			targetsBoundary(async () => toConnectionView(await importService.importOne(toImportInput(input)))),

		importMany: (inputs) =>
			targetsBoundary(async () =>
				toImportItems(
					await importConnections(inputs.map(toImportInput), (command) => importService.importOne(command)),
				),
			),

		proxies: {
			list: () => targetsBoundary(async () => (await proxies.list()).map(toProxyView)),

			get: (id) =>
				targetsBoundary(async () => {
					const record = await proxies.get(id);
					return record === null ? null : toProxyView(record);
				}),

			create: (input) => targetsBoundary(async () => toProxyView(await proxies.create(toProxyInput(input)))),

			update: (id, version, input) =>
				targetsBoundary(async () => toProxyMutation(await proxies.update(id, version, toProxyPatch(input)))),

			delete: (id) => targetsBoundary(async () => Boolean(await proxies.delete(id))),
		},
		tags: {
			list: () => targetsBoundary(async () => (await tags.list()).map(toTagView)),

			get: (id) =>
				targetsBoundary(async () => {
					const record = await tags.get(id);
					return record === null ? null : toTagView(record);
				}),

			create: (name) => targetsBoundary(async () => toTagView(await tags.create(name))),

			rename: (id, version, name) =>
				targetsBoundary(async () => toTagMutation(await tags.rename(id, version, name))),

			delete: (id) => targetsBoundary(async () => Boolean(await tags.delete(id))),
		},
		sshKeys: {
			list: () => targetsBoundary(async () => (await sshKeys.list()).map(toSshKeyView)),

			get: (id) =>
				targetsBoundary(async () => {
					const record = await sshKeys.get(id);
					return record === null ? null : toSshKeyView(record);
				}),

			create: (input) => targetsBoundary(async () => toSshKeyView(await sshKeys.create(toSshKeyInput(input)))),

			update: (id, version, input) =>
				targetsBoundary(async () => toSshKeyMutation(await sshKeys.update(id, version, toSshKeyPatch(input)))),

			delete: (id) => targetsBoundary(async () => Boolean(await sshKeys.delete(id))),
		},
		credentials: {
			set: (id, version, input) =>
				targetsBoundary(async () =>
					toCredentialMutation(await credentials.set(id, version, toCredentialInput(input))),
				),

			clear: (id, version) =>
				targetsBoundary(async () => toCredentialMutation(await credentials.clear(id, version))),
		},
	};

	const trustedSshTargets: TrustedSshTargetResolver = {
		fingerprintStored: (id) => targetsBoundary(async () => String(await resolver.fingerprintStored(id))),

		resolveStored: (request) =>
			targetsBoundary(async () => toTrustedTargetView(await resolver.resolveStored(request))),
	};

	return {
		publicApi,
		trustedSshTargets,

		routes: (access) => createTargetsRoutes(access, publicApi),
	};
}
