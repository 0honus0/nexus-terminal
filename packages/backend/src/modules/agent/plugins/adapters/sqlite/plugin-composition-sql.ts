import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import type {
	StoredPluginAppBinding,
	StoredPluginPackageInstallation,
	StoredPluginPackageReference,
} from '../../storage/plugin-composition-storage.js';
import { isAgentPluginVersion } from '@nexus-terminal/shared/agent/plugins/values';

function text(value: unknown): string {
	if (typeof value !== 'string' || !value) {
		throw new Error('Invalid plugin package identity');
	}
	return value;
}

function revision(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
		throw new Error('Invalid plugin revision');
	}
	return value;
}

export function packageReference(row: SqlRow): StoredPluginPackageReference {
	const packageId = text(row.package_id),
		version = text(row.version),
		packageHash = text(row.package_hash),
		publisherKeyId = text(row.publisher_key_id);
	if (
		!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/u.test(packageId) ||
		!isAgentPluginVersion(version) ||
		!/^[a-f0-9]{64}$/u.test(packageHash) ||
		!/^ed25519:[a-f0-9]{64}$/u.test(publisherKeyId)
	) {
		throw new Error('Corrupt plugin package reference');
	}
	return { packageId, version, packageHash, publisherKeyId };
}

export function packageInstallation(row: SqlRow): StoredPluginPackageInstallation {
	const status = row.status;
	if (status !== 'installed' && status !== 'draining' && status !== 'removed' && status !== 'incompatible') {
		throw new Error('Corrupt package status');
	}
	const createdAt = row.created_at,
		updatedAt = row.updated_at;
	if (
		typeof createdAt !== 'number' ||
		!Number.isSafeInteger(createdAt) ||
		createdAt < 0 ||
		typeof updatedAt !== 'number' ||
		!Number.isSafeInteger(updatedAt) ||
		updatedAt < createdAt
	) {
		throw new Error('Corrupt package timestamp');
	}
	return { package: packageReference(row), status, revision: revision(row.revision), createdAt, updatedAt };
}

export async function readAppBinding(
	tx: SqlExecutor,
	userId: number,
	appId: string,
): Promise<StoredPluginAppBinding | null> {
	const binding = await tx.one('SELECT * FROM agent_plugin_app_bindings WHERE user_id=? AND app_id=?', [
		userId,
		appId,
	]);
	if (!binding) {
		return null;
	}
	const rows = await tx.all(
		'SELECT * FROM agent_plugin_app_packages WHERE user_id=? AND app_id=? ORDER BY package_id',
		[userId, appId],
	);
	const apps = rows.filter((row) => row.kind === 'app'),
		ui = rows.filter((row) => row.kind === 'ui');
	if (
		apps.length !== 1 ||
		ui.length > 1 ||
		rows.some((row) => row.kind !== 'app' && row.kind !== 'tool' && row.kind !== 'ui')
	) {
		throw new Error('Corrupt App composition');
	}
	const app = apps[0];
	if (!app) {
		throw new Error('App composition package missing');
	}
	return {
		appId,
		executionRevision: revision(binding.execution_revision),
		uiRevision: revision(binding.ui_revision),
		app: packageReference(app),
		dependencies: rows.filter((row) => row.kind === 'tool').map(packageReference),
		selectedRootIds: [
			...new Set(
				rows
					.filter((row) => row.kind !== 'app' && row.selected_root === 1)
					.map((row) => packageReference(row).packageId),
			),
		],
		ui: ui[0] ? packageReference(ui[0]) : null,
	};
}

export async function writeAppBinding(tx: SqlExecutor, userId: number, binding: StoredPluginAppBinding): Promise<void> {
	await tx.run('INSERT INTO agent_plugin_app_bindings VALUES(?,?,?,?)', [
		userId,
		binding.appId,
		binding.executionRevision,
		binding.uiRevision,
	]);
	await writeAppPackageReferences(tx, userId, binding);
}

export async function writeAppPackageReferences(
	tx: SqlExecutor,
	userId: number,
	binding: StoredPluginAppBinding,
): Promise<void> {
	const references: { kind: 'app' | 'tool' | 'ui'; value: StoredPluginPackageReference }[] = [
		{ kind: 'app', value: binding.app },
		...binding.dependencies.map((value) => ({ kind: 'tool' as const, value })),
	];
	if (binding.ui) {
		references.push({ kind: 'ui', value: binding.ui });
	}
	for (const reference of references) {
		const value = reference.value;
		await tx.run(
			'INSERT INTO agent_plugin_app_packages(user_id,app_id,package_id,kind,version,package_hash,publisher_key_id,selected_root) VALUES(?,?,?,?,?,?,?,?)',
			[
				userId,
				binding.appId,
				value.packageId,
				reference.kind,
				value.version,
				value.packageHash,
				value.publisherKeyId,
				reference.kind === 'app' || binding.selectedRootIds.includes(value.packageId) ? 1 : 0,
			],
		);
	}
}
