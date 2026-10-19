import type { SqlExecutor } from '../../platform/storage/sqlite/sql-types.js';
import { SecureSessionTokens } from '../../platform/security/adapters/secure-session-tokens.js';
import { SqliteManagementStorage } from './management/adapters/sqlite/management-sql.js';
import { ManagementModel } from './management/model/management-model.js';
import { ManagementService } from './management/service/management-service.js';
import { registerTargetsSnapshot } from './snapshots/adapters/sqlite/snapshot-registration.js';
import type { SnapshotRegistration } from '../../platform/storage/sqlite/snapshot-types.js';
import { importConnections } from './import/connection-import-batch.js';
import type { SqliteRuntime } from '../../platform/storage/sqlite/sqlite-runtime.js';
import type { SecretBox } from '../../platform/security/secret-box.js';
import {
	ConnectionSqliteAdapter,
	insertConnectionInTransaction,
} from './connections/adapters/sqlite/connection-sql.js';
import {
	SqliteConnectionCredentialStorage,
	writeCredentialInTransaction,
} from './connections/adapters/sqlite/connection-credential-sql.js';
import {
	ConnectionCredentialModel,
	validateStoredCredentialWrite,
} from './connections/model/connection-credential-model.js';
import { ConnectionCredentialService } from './connections/service/connection-credential-service.js';
import {
	ConnectionModel,
	validateStoredConnectionGraph,
	validateStoredConnectionSnapshot,
	validateStoredConnectionTypeChange,
} from './connections/model/connection-model.js';
import { ConnectionService } from './connections/service/connection-service.js';
import { SqliteDesktopTargetAdapter } from './connections/adapters/sqlite/desktop-target-sql.js';
import { DesktopTargetModel } from './connections/model/desktop-target-model.js';
import { DesktopTargetService } from './connections/service/desktop-target-service.js';
import { toTrustedDesktopTarget } from './public-mappers.js';
import { findOrCreateProxy } from './proxies/adapters/sqlite/proxy-sql.js';
import { SqliteProxyStorage } from './proxies/adapters/sqlite/proxy-management-sql.js';
import { ProxyModel } from './proxies/model/proxy-model.js';
import { ProxyService } from './proxies/service/proxy-service.js';
import { findOrCreateTag } from './tags/adapters/sqlite/tag-sql.js';
import { SqliteTagStorage } from './tags/adapters/sqlite/tag-management-sql.js';
import { assignConnectionTag, detachConnectionTag } from './connections/adapters/sqlite/connection-tag-sql.js';
import { toTagConnections } from './public-mappers.js';
import { TagModel } from './tags/model/tag-model.js';
import { TagService } from './tags/service/tag-service.js';
import { SqliteSshKeyStorage, insertSshKeyInTransaction } from './ssh-keys/adapters/sqlite/ssh-key-sql.js';
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
	toCredentialView,
	toTrustedTargetView,
	toHostKeyView,
	toUnsavedTargetInput,
	toTrustedUnsavedTarget,
	toStoredTargetRequest,
} from './public-mappers.js';

interface TargetsRegistrationOptions {
	sqlite: SqliteRuntime;
	secrets: SecretBox | null;
}

interface TargetsRegistration {
	installTransactionIdentityReader(read: (tx: SqlExecutor, digest: string) => Promise<number | null>): void;
	publicApi: TargetsPublicApi;
	trustedSshTargets: TrustedSshTargetResolver;
	routes(access: AccessPublicApi): HttpRoute[];
}

/** Register real internal owners; expose only explicit, allowlisted projections. */
export function registerTargets({ sqlite, secrets }: TargetsRegistrationOptions): TargetsRegistration {
	const managementStorage = new SqliteManagementStorage(sqlite);
	const management = new ManagementService(new ManagementModel(managementStorage, new SecureSessionTokens()));
	const model = new ConnectionModel(
		new ConnectionSqliteAdapter(sqlite, validateStoredConnectionGraph, validateStoredConnectionTypeChange),
	);
	const service = new ConnectionService(model);
	const desktopTargets = new DesktopTargetService(
		new DesktopTargetModel(new SqliteDesktopTargetAdapter(sqlite), secrets),
	);
	const imports = new SqliteConnectionImportAdapter(sqlite, {
		connections: {
			insert: (tx, data) => insertConnectionInTransaction(tx, data, validateStoredConnectionGraph),
		},
		proxies: { findOrCreate: findOrCreateProxy },
		tags: { findOrCreate: findOrCreateTag },
		sshKeys: { insert: insertSshKeyInTransaction },
		credentials: { write: writeCredentialInTransaction },
	});
	const importService = new ConnectionImportService(new ConnectionImportModel(imports, secrets));
	const proxies = new ProxyService(new ProxyModel(new SqliteProxyStorage(sqlite), secrets));
	const tags = new TagService(
		new TagModel(new SqliteTagStorage(sqlite, { assign: assignConnectionTag, detach: detachConnectionTag })),
	);
	const sshKeys = new SshKeyService(new SshKeyModel(new SqliteSshKeyStorage(sqlite), secrets));
	const credentials = new ConnectionCredentialService(
		new ConnectionCredentialModel(
			new SqliteConnectionCredentialStorage(sqlite, validateStoredCredentialWrite),
			secrets,
		),
	);
	const resolver = new SshTargetService(new SshTargetModel(new SqliteSshTargetStorage(sqlite), secrets));
	const hostKeys = new HostKeyService(new HostKeyModel(new SqliteHostKeyStorage(sqlite)));

	const publicApi: TargetsPublicApi = {
		desktopTargets: {
			get: (id) =>
				targetsBoundary(async () => {
					const value = await desktopTargets.get(id);
					return value === null ? null : toTrustedDesktopTarget(value);
				}),

			markAttempt: (id, version, timestamp) =>
				targetsBoundary(() => desktopTargets.markAttempt(id, version, timestamp)),
		},
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

		listEntries: (ids) =>
			targetsBoundary(async () =>
				(await service.listEntries(ids.map((id) => id))).map((entry) => ({
					id: entry.id,
					version: entry.version,
					type: entry.type,
					name: entry.name,
					host: entry.host,
					port: entry.port,
					username: entry.username,
				})),
			),

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

		delete: (id) => targetsBoundary(() => service.delete(id)),

		setTags: (id, version, tagIds) =>
			targetsBoundary(async () => toConnectionMutation(await service.setTags(id, version, [...tagIds]))),

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

			delete: (id) => targetsBoundary(() => proxies.delete(id)),
		},
		tags: {
			setConnections: (id, ids) => targetsBoundary(() => tags.setConnections(toTagConnections(id, ids))),

			addConnections: (id, ids) => targetsBoundary(() => tags.addConnections(toTagConnections(id, ids))),

			list: () => targetsBoundary(async () => (await tags.list()).map(toTagView)),

			get: (id) =>
				targetsBoundary(async () => {
					const record = await tags.get(id);
					return record === null ? null : toTagView(record);
				}),

			create: (name) => targetsBoundary(async () => toTagView(await tags.create(name))),

			rename: (id, version, name) =>
				targetsBoundary(async () => toTagMutation(await tags.rename(id, version, name))),

			delete: (id) => targetsBoundary(() => tags.delete(id)),
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

			delete: (id) => targetsBoundary(() => sshKeys.delete(id)),
		},
		credentials: {
			get: (id) =>
				targetsBoundary(async () => {
					const row = await credentials.get(id);
					return row === null ? null : toCredentialView(row);
				}),

			set: (id, version, input) =>
				targetsBoundary(async () =>
					toCredentialMutation(await credentials.set(id, version, toCredentialInput(input))),
				),

			clear: (id, version) =>
				targetsBoundary(async () => toCredentialMutation(await credentials.clear(id, version))),
		},
	};

	const trustedSshTargets: TrustedSshTargetResolver = {
		fingerprintStored: (id) => targetsBoundary(() => resolver.fingerprintStored(id)),

		resolveStored: (request) =>
			targetsBoundary(async () =>
				toTrustedTargetView(await resolver.resolveStored(toStoredTargetRequest(request))),
			),

		resolveUnsaved: (request) =>
			targetsBoundary(async () =>
				toTrustedUnsavedTarget(await resolver.resolveUnsaved(toUnsavedTargetInput(request))),
			),
	};

	return {
		publicApi,
		trustedSshTargets,

		installTransactionIdentityReader: (read) => managementStorage.installTransactionIdentityReader(read),

		routes: (access) => createTargetsRoutes(access, publicApi, management),
	};
}

/** Installation-only fixed storage coverage; no business records leave the adapter. */
export function registerTargetsBackup(secrets: SecretBox | null): SnapshotRegistration {
	return registerTargetsSnapshot(secrets, validateStoredConnectionSnapshot, validateStoredCredentialWrite);
}
