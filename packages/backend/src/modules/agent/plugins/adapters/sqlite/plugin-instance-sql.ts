import { randomUUID } from 'node:crypto';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import type {
	PluginInstanceStorage,
	StoredPluginConfiguration,
	StoredPluginConfigurationPrincipal,
	StoredPluginInstance,
	StoredPluginInstanceSource,
} from '../../storage/plugin-instance-storage.js';
import { PluginInstanceRefusal } from '../../storage/plugin-instance-storage.js';
import { pluginManifest } from '../package/plugin-manifest.js';
import { packageReference } from './plugin-composition-sql.js';
import type { StoredPluginDataRecord, StoredPluginDataPage } from '../../storage/plugin-data-storage.js';

function text(value: unknown): string {
	if (typeof value !== 'string') {
		throw new Error('Invalid plugin instance text');
	}
	return value;
}

function integer(value: unknown, minimum = 0): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
		throw new Error('Invalid plugin instance integer');
	}
	return value;
}

function flag(value: unknown): boolean {
	if (value !== 0 && value !== 1) {
		throw new Error('Invalid plugin instance flag');
	}
	return value === 1;
}

function instance(row: SqlRow): StoredPluginInstance {
	return {
		id: text(row.id),
		appId: text(row.app_id),
		packageId: text(row.package_id),
		name: text(row.name),
		selected: flag(row.selected),
		enabled: flag(row.enabled),
		revision: integer(row.revision, 1),
		createdAt: integer(row.created_at),
		updatedAt: integer(row.updated_at),
	};
}

export function readStoredPluginConfiguration(row: SqlRow): StoredPluginConfiguration {
	const documentJson = text(row.configuration_json);
	const parsed: unknown = JSON.parse(documentJson);
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('Invalid plugin configuration document');
	}
	return {
		instanceId: text(row.id),
		packageId: text(row.package_id),
		revision: integer(row.configuration_revision),
		schemaRevision: integer(row.schema_revision),
		documentJson,
	};
}

export async function readPluginInstanceSource(
	tx: SqlExecutor,
	userId: number,
	appId: string,
	instanceId: string,
): Promise<StoredPluginInstanceSource> {
	const row = await tx.one('SELECT * FROM agent_plugin_instances WHERE user_id=? AND app_id=? AND id=?', [
		userId,
		appId,
		instanceId,
	]);
	if (!row) {
		throw new PluginInstanceRefusal('not_found');
	}
	const stored = instance(row);
	const code = await tx.one(
		`SELECT p.*,v.manifest_json FROM agent_plugin_packages p
	 JOIN agent_plugin_versions v ON v.user_id=p.user_id AND v.definition_id=p.package_id AND v.version=p.version
	 AND v.package_hash=p.package_hash AND v.publisher_key_id=p.publisher_key_id
	 JOIN agent_plugin_publishers k ON k.user_id=p.user_id AND k.key_id=p.publisher_key_id
	 JOIN agent_plugin_app_packages ref ON ref.user_id=p.user_id AND ref.package_id=p.package_id AND ref.version=p.version
	 AND ref.package_hash=p.package_hash AND ref.publisher_key_id=p.publisher_key_id
	 JOIN agent_plugin_installations app ON app.user_id=ref.user_id AND app.app_id=ref.app_id
	 WHERE p.user_id=? AND ref.app_id=? AND p.package_id=? AND p.status='installed'
	 AND app.status='installed' AND k.revoked_at IS NULL LIMIT 1`,
		[userId, appId, stored.packageId],
	);
	if (!code) {
		throw new PluginInstanceRefusal('version_conflict');
	}
	return {
		instance: stored,
		configuration: readStoredPluginConfiguration(row),
		package: packageReference(code),
		packageRevision: integer(code.revision, 1),
		manifest: pluginManifest(JSON.parse(text(code.manifest_json))),
	};
}

export class SqlitePluginInstanceStorage implements PluginInstanceStorage {
	private identityReader: ((tx: SqlExecutor, digest: string) => Promise<number | null>) | null = null;

	constructor(private readonly db: SqliteRuntime) {}

	private async dataScope(
		tx: SqlExecutor,
		principal: StoredPluginConfigurationPrincipal,
		write: boolean,
	): Promise<readonly [number, string, string, string, string]> {
		if (principal.kind !== 'run') {
			throw new PluginInstanceRefusal('forbidden');
		}
		await this.principal(tx, principal, principal.appId, write);
		const source = await readPluginInstanceSource(
			tx,
			principal.userId,
			principal.appId,
			principal.callerInstanceId,
		);
		return [
			principal.userId,
			principal.appId,
			source.package.publisherKeyId,
			source.package.packageId,
			principal.callerInstanceId,
		];
	}

	dataRead(
		principal: StoredPluginConfigurationPrincipal,
		namespace: string,
		key: string,
	): Promise<StoredPluginDataRecord | null> {
		return this.db.transaction(async (tx) => {
			const scope = await this.dataScope(tx, principal, false);
			const row = await tx.one(
				`SELECT key,revision,document_json FROM agent_plugin_private_data
			 WHERE user_id=? AND app_id=? AND publisher_key_id=? AND package_id=? AND instance_id=? AND namespace=? AND key=?`,
				[...scope, namespace, key],
			);
			return row
				? {
						key: text(row.key),
						revision: integer(row.revision, 1),
						documentJson: row.document_json === null ? null : text(row.document_json),
					}
				: null;
		});
	}

	dataList(
		principal: StoredPluginConfigurationPrincipal,
		namespace: string,
		after: string | null,
		byteBudget: number,
	): Promise<StoredPluginDataPage> {
		return this.db.transaction(async (tx) => {
			const scope = await this.dataScope(tx, principal, false);
			const items: StoredPluginDataPage['items'] = [];
			let cursor = after;
			let bytes = Buffer.byteLength(JSON.stringify({ items: [], nextCursor: null }));
			// Fetch metadata incrementally, so storage size does not become an in-memory page limit.
			for (;;) {
				const row = await tx.one(
					`SELECT key,revision,document_json IS NULL AS deleted FROM agent_plugin_private_data
				 WHERE user_id=? AND app_id=? AND publisher_key_id=? AND package_id=? AND instance_id=? AND namespace=?
				 AND (? IS NULL OR key>?) ORDER BY key LIMIT 1`,
					[...scope, namespace, cursor, cursor],
				);
				if (!row) {
					return { items, nextCursor: null };
				}
				const entry = { key: text(row.key), revision: integer(row.revision, 1), deleted: flag(row.deleted) };
				const size = Buffer.byteLength(JSON.stringify(entry)) + 1;
				if (bytes + size + Buffer.byteLength(JSON.stringify(entry.key)) > byteBudget) {
					if (!items.length) {
						throw new PluginInstanceRefusal('limit_exceeded');
					}
					return { items, nextCursor: cursor };
				}
				items.push(entry);
				bytes += size;
				cursor = entry.key;
			}
		});
	}

	dataWrite(
		principal: StoredPluginConfigurationPrincipal,
		namespace: string,
		key: string,
		expectedRevision: number,
		documentJson: string | null,
		now: number,
	): Promise<StoredPluginDataRecord> {
		return this.db.transaction(async (tx) => {
			const scope = await this.dataScope(tx, principal, true);
			const row = await tx.one(
				`SELECT revision FROM agent_plugin_private_data
			 WHERE user_id=? AND app_id=? AND publisher_key_id=? AND package_id=? AND instance_id=? AND namespace=? AND key=?`,
				[...scope, namespace, key],
			);
			if ((row ? integer(row.revision, 1) : 0) !== expectedRevision) {
				throw new PluginInstanceRefusal('version_conflict');
			}
			if (expectedRevision >= Number.MAX_SAFE_INTEGER) {
				throw new PluginInstanceRefusal('limit_exceeded');
			}
			const revision = expectedRevision + 1;
			await tx.run(
				`INSERT INTO agent_plugin_private_data(user_id,app_id,publisher_key_id,package_id,instance_id,namespace,key,revision,document_json,updated_at)
			 VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,app_id,publisher_key_id,package_id,instance_id,namespace,key)
			 DO UPDATE SET revision=excluded.revision,document_json=excluded.document_json,updated_at=excluded.updated_at`,
				[...scope, namespace, key, revision, documentJson, now],
			);
			return { key, revision, documentJson };
		});
	}

	installIdentityReader(reader: (tx: SqlExecutor, digest: string) => Promise<number | null>): void {
		if (this.identityReader) {
			throw new Error('Plugin instance identity reader already installed');
		}
		this.identityReader = reader;
	}

	private async manual(tx: SqlExecutor, userId: number, digest: string): Promise<void> {
		if (!this.identityReader || (await this.identityReader(tx, digest)) !== userId) {
			throw new PluginInstanceRefusal('unauthenticated');
		}
	}

	private async principal(
		tx: SqlExecutor,
		principal: StoredPluginConfigurationPrincipal,
		appId: string,
		write: boolean,
	): Promise<void> {
		if (principal.kind === 'manual') {
			return this.manual(tx, principal.userId, principal.digest);
		}
		if (principal.appId !== appId || (write && principal.operationId === null)) {
			throw new PluginInstanceRefusal('forbidden');
		}
		const row = await tx.one(
			`SELECT r.id FROM agent_runs r
		 JOIN agent_run_executions e ON e.run_id=r.id AND e.generation=? AND e.state='open'
		 JOIN agent_apps a ON a.id=r.app_id AND a.user_id=r.user_id AND a.enabled=1
		 JOIN agent_governance_policies p ON p.user_id=r.user_id AND p.app_id=r.app_id AND p.policy_revision=?
		 JOIN agent_plugin_runtime_instances caller ON caller.user_id=r.user_id AND caller.app_id=r.app_id
		 JOIN agent_plugin_instances logical ON logical.user_id=caller.user_id AND logical.app_id=caller.app_id
		 AND logical.id=caller.logical_instance_id AND logical.enabled=1 AND logical.configuration_revision=caller.configuration_revision
		 JOIN agent_plugin_packages code ON code.user_id=caller.user_id AND code.package_id=caller.package_id
		 AND code.status='installed' AND code.revision=caller.revision
		 JOIN agent_plugin_publishers publisher ON publisher.user_id=code.user_id AND publisher.key_id=code.publisher_key_id
		 AND publisher.revoked_at IS NULL
		 WHERE r.user_id=? AND r.app_id=? AND r.id=? AND r.status='running' AND r.deadline_at>?
		 AND caller.logical_instance_id=? AND caller.generation=? AND caller.state='active'
		 AND (? IS NULL OR EXISTS(SELECT 1 FROM agent_operations o WHERE o.id=? AND o.run_id=r.id
		 AND o.execution_generation=e.generation AND o.state='dispatched'))`,
			[
				principal.executionGeneration,
				principal.policyRevision,
				principal.userId,
				appId,
				principal.runId,
				Date.now(),
				principal.callerInstanceId,
				principal.callerGeneration,
				principal.operationId,
				principal.operationId,
			],
		);
		if (!row) {
			throw new PluginInstanceRefusal('version_conflict');
		}
		for (const participant of principal.participants) {
			const current = await tx.one(
				`SELECT runtime.instance_id FROM agent_plugin_runtime_instances runtime
			 JOIN agent_plugin_instances logical ON logical.id=runtime.logical_instance_id AND logical.user_id=runtime.user_id
			 AND logical.app_id=runtime.app_id AND logical.enabled=1 AND logical.configuration_revision=runtime.configuration_revision
			 JOIN agent_plugin_packages code ON code.user_id=runtime.user_id AND code.package_id=runtime.package_id
			 AND code.status='installed' AND code.revision=runtime.revision
			 JOIN agent_plugin_app_packages ref ON ref.user_id=code.user_id AND ref.app_id=runtime.app_id AND ref.package_id=code.package_id
			 AND ref.version=code.version AND ref.package_hash=code.package_hash AND ref.publisher_key_id=code.publisher_key_id
			 JOIN agent_plugin_publishers publisher ON publisher.user_id=code.user_id AND publisher.key_id=code.publisher_key_id
			 AND publisher.revoked_at IS NULL
			 WHERE runtime.user_id=? AND runtime.app_id=? AND runtime.logical_instance_id=? AND runtime.package_id=?
			 AND runtime.generation=? AND runtime.configuration_revision=? AND runtime.revision=? AND runtime.state='active'`,
				[
					principal.userId,
					appId,
					participant.instanceId,
					participant.packageId,
					participant.generation,
					participant.configurationRevision,
					participant.packageRevision,
				],
			);
			if (!current) {
				throw new PluginInstanceRefusal('version_conflict');
			}
		}
	}

	list(userId: number, appId: string): Promise<StoredPluginInstance[]> {
		return this.db
			.all('SELECT * FROM agent_plugin_instances WHERE user_id=? AND app_id=? ORDER BY created_at,id', [
				userId,
				appId,
			])
			.then((rows) => rows.map(instance));
	}

	listAuthorized(principal: StoredPluginConfigurationPrincipal, appId: string): Promise<StoredPluginInstance[]> {
		return this.db.transaction(async (tx) => {
			await this.principal(tx, principal, appId, false);
			return (
				await tx.all(
					`SELECT logical.* FROM agent_plugin_instances logical
			 JOIN agent_plugin_installations app ON app.user_id=logical.user_id AND app.app_id=logical.app_id
			 WHERE logical.user_id=? AND logical.app_id=? AND app.status='installed' ORDER BY logical.created_at,logical.id`,
					[principal.userId, appId],
				)
			).map(instance);
		});
	}

	source(userId: number, appId: string, instanceId: string): Promise<StoredPluginInstanceSource> {
		return this.db.transaction((tx) => readPluginInstanceSource(tx, userId, appId, instanceId));
	}

	read(
		principal: StoredPluginConfigurationPrincipal,
		appId: string,
		instanceId: string,
	): Promise<StoredPluginInstanceSource> {
		return this.db.transaction(async (tx) => {
			await this.principal(tx, principal, appId, false);
			return readPluginInstanceSource(tx, principal.userId, appId, instanceId);
		});
	}

	create(
		userId: number,
		digest: string,
		appId: string,
		packageId: string,
		id: string,
		name: string,
		now: number,
	): Promise<StoredPluginInstance> {
		return this.db.transaction(async (tx) => {
			await this.manual(tx, userId, digest);
			const code = await tx.one(
				`SELECT v.manifest_json FROM agent_plugin_app_packages ref
			 JOIN agent_plugin_packages p ON p.user_id=ref.user_id AND p.package_id=ref.package_id AND p.version=ref.version
			 AND p.package_hash=ref.package_hash AND p.publisher_key_id=ref.publisher_key_id
			 JOIN agent_plugin_publishers k ON k.user_id=p.user_id AND k.key_id=p.publisher_key_id AND k.revoked_at IS NULL
			 JOIN agent_plugin_versions v ON v.user_id=p.user_id AND v.definition_id=p.package_id AND v.version=p.version
			 WHERE ref.user_id=? AND ref.app_id=? AND ref.package_id=? AND p.status='installed' LIMIT 1`,
				[userId, appId, packageId],
			);
			if (!code) {
				throw new PluginInstanceRefusal('not_found');
			}
			const manifest = pluginManifest(JSON.parse(text(code.manifest_json)));
			await tx.run(`INSERT INTO agent_plugin_instances VALUES(?,?,?,?,?,1,1,1,0,?,?,?,?)`, [
				id,
				userId,
				appId,
				packageId,
				name,
				manifest.contributions.settings?.schemaRevision ?? 0,
				manifest.contributions.settings?.defaultsJson ?? '{}',
				now,
				now,
			]);
			return (await readPluginInstanceSource(tx, userId, appId, id)).instance;
		});
	}

	update(
		userId: number,
		digest: string,
		appId: string,
		instanceId: string,
		expectedRevision: number,
		input: { name: string; selected: boolean; enabled: boolean },
		now: number,
	): Promise<StoredPluginInstance> {
		return this.db.transaction(async (tx) => {
			await this.manual(tx, userId, digest);
			const current = await readPluginInstanceSource(tx, userId, appId, instanceId);
			if (
				current.instance.revision !== expectedRevision ||
				expectedRevision >= Number.MAX_SAFE_INTEGER ||
				(current.package.packageId === current.manifest.id &&
					instanceId === appId &&
					(!input.enabled || !input.selected))
			) {
				throw new PluginInstanceRefusal('version_conflict');
			}
			await tx.run(
				`UPDATE agent_plugin_instances SET name=?,selected=?,enabled=?,revision=revision+1,updated_at=?
			 WHERE user_id=? AND app_id=? AND id=? AND revision=?`,
				[
					input.name,
					input.selected ? 1 : 0,
					input.enabled ? 1 : 0,
					now,
					userId,
					appId,
					instanceId,
					expectedRevision,
				],
			);
			return (await readPluginInstanceSource(tx, userId, appId, instanceId)).instance;
		});
	}

	write(
		principal: StoredPluginConfigurationPrincipal,
		appId: string,
		instanceId: string,
		command: Parameters<PluginInstanceStorage['write']>[3],
		validate: Parameters<PluginInstanceStorage['write']>[4],
	) {
		return this.db.transaction(async (tx) => {
			await this.principal(tx, principal, appId, true);
			const callerId =
				principal.kind === 'manual'
					? 'manual:' + principal.userId
					: principal.runId + ':' + principal.callerInstanceId;
			const original = await tx.one(
				`SELECT request_hash,result_json,retired FROM agent_plugin_configuration_mutations
			 WHERE user_id=? AND app_id=? AND instance_id=? AND caller_id=? AND operation_key=?`,
				[principal.userId, appId, instanceId, callerId, command.operationKey],
			);
			if (original) {
				if (original.retired === 1) {
					throw new PluginInstanceRefusal('version_conflict');
				}
				if (original.request_hash !== command.requestHash) {
					throw new PluginInstanceRefusal('idempotency_conflict');
				}
				const raw: unknown = JSON.parse(text(original.result_json));
				if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
					throw new Error('Invalid plugin configuration receipt');
				}
				const configurationJson = 'configuration_json' in raw ? raw.configuration_json : null;
				const revision = 'configuration_revision' in raw ? raw.configuration_revision : null;
				const schemaRevision = 'schema_revision' in raw ? raw.schema_revision : null;
				const packageId = 'package_id' in raw ? raw.package_id : null;
				const changed = 'changed' in raw ? raw.changed : null;
				if (typeof changed !== 'boolean') {
					throw new Error('Invalid plugin configuration receipt flag');
				}
				return {
					configuration: readStoredPluginConfiguration({
						id: instanceId,
						package_id: packageId,
						configuration_json: configurationJson,
						configuration_revision: revision,
						schema_revision: schemaRevision,
					}),
					changed,
				};
			}
			const current = await readPluginInstanceSource(tx, principal.userId, appId, instanceId);
			if (
				current.configuration.revision !== command.expectedRevision ||
				command.expectedRevision >= Number.MAX_SAFE_INTEGER
			) {
				throw new PluginInstanceRefusal('version_conflict');
			}
			const { changed } = validate(current);
			if (changed) {
				await tx.run(
					`UPDATE agent_plugin_instances SET configuration_json=?,schema_revision=?,configuration_revision=configuration_revision+1,
				 updated_at=? WHERE user_id=? AND app_id=? AND id=? AND configuration_revision=?`,
					[
						command.documentJson,
						command.schemaRevision,
						command.now,
						principal.userId,
						appId,
						instanceId,
						command.expectedRevision,
					],
				);
			}
			const result = (await readPluginInstanceSource(tx, principal.userId, appId, instanceId)).configuration;
			await tx.run(
				'INSERT INTO agent_plugin_configuration_mutations(user_id,app_id,instance_id,caller_id,operation_key,request_hash,result_json,created_at) VALUES(?,?,?,?,?,?,?,?)',
				[
					principal.userId,
					appId,
					instanceId,
					callerId,
					command.operationKey,
					command.requestHash,
					JSON.stringify({
						package_id: result.packageId,
						configuration_json: result.documentJson,
						configuration_revision: result.revision,
						schema_revision: result.schemaRevision,
						changed,
					}),
					command.now,
				],
			);
			return { configuration: result, changed };
		});
	}
}

/** New App/package membership creates one default logical instance; subsequent explicit instances keep their own data. */
export async function ensurePluginInstances(
	tx: SqlExecutor,
	userId: number,
	binding: import('../../storage/plugin-composition-storage.js').StoredPluginAppBinding,
	candidates: readonly import('../../storage/plugin-composition-storage.js').StoredPluginCompositionCandidate[],
	now: number,
): Promise<void> {
	const references = [binding.app, ...binding.dependencies, ...(binding.ui ? [binding.ui] : [])];
	for (const reference of references) {
		const present = await tx.one(
			'SELECT id FROM agent_plugin_instances WHERE user_id=? AND app_id=? AND package_id=? LIMIT 1',
			[userId, binding.appId, reference.packageId],
		);
		if (present) {
			continue;
		}
		const candidate = candidates.find((item) => item.manifest.id === reference.packageId);
		if (!candidate) {
			throw new PluginInstanceRefusal('version_conflict');
		}
		const isApp = reference.packageId === binding.app.packageId;
		const id = isApp ? binding.appId : randomUUID();
		await tx.run('INSERT INTO agent_plugin_instances VALUES(?,?,?,?,?,?,1,1,0,?,?,?,?)', [
			id,
			userId,
			binding.appId,
			reference.packageId,
			candidate.manifest.displayName,
			isApp || binding.selectedRootIds.includes(reference.packageId) ? 1 : 0,
			candidate.manifest.contributions.settings?.schemaRevision ?? 0,
			candidate.manifest.contributions.settings?.defaultsJson ?? '{}',
			now,
			now,
		]);
	}
}
