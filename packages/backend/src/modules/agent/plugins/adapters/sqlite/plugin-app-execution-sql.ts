import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { StoredPluginAppExecution } from '../../storage/plugin-app-execution-storage.js';
import type { StoredPluginPackageReference } from '../../storage/plugin-composition-storage.js';
import { readAppBinding } from './plugin-composition-sql.js';
import { pluginManifest } from '../package/plugin-manifest.js';
import { AGENT_PLUGIN_SDK_VERSION } from '@nexus-terminal/shared/agent/plugins/values';
import semver from 'semver';

export async function appExecutionBinding(
	tx: SqlExecutor,
	userId: number,
	appId: string,
	allowDraining = false,
): Promise<StoredPluginAppExecution | null> {
	const current = await tx.one(
		`SELECT i.definition_id,i.version,i.package_hash,i.publisher_key_id FROM agent_plugin_installations i
	 JOIN agent_apps a ON a.user_id=i.user_id AND a.id=i.app_id
	 WHERE i.user_id=? AND i.app_id=? AND i.status='installed' AND a.enabled=1`,
		[userId, appId],
	);
	if (!current) {
		return null;
	}
	const binding = await readAppBinding(tx, userId, appId);
	if (
		!binding ||
		current.definition_id !== binding.app.packageId ||
		current.version !== binding.app.version ||
		current.package_hash !== binding.app.packageHash ||
		current.publisher_key_id !== binding.app.publisherKeyId
	) {
		return null;
	}

	const readManifest = async (reference: StoredPluginPackageReference) => {
		const row = await tx.one(
			`SELECT v.manifest_json FROM agent_plugin_packages p
		 JOIN agent_plugin_publishers k ON k.user_id=p.user_id AND k.key_id=p.publisher_key_id
		 JOIN agent_plugin_versions v ON v.user_id=p.user_id AND v.definition_id=p.package_id AND v.version=p.version AND v.package_hash=p.package_hash AND v.publisher_key_id=p.publisher_key_id
		 WHERE p.user_id=? AND p.package_id=? AND p.version=? AND p.package_hash=? AND p.publisher_key_id=?
		 AND (p.status='installed' OR (?=1 AND p.status='draining')) AND k.revoked_at IS NULL`,
			[
				userId,
				reference.packageId,
				reference.version,
				reference.packageHash,
				reference.publisherKeyId,
				allowDraining ? 1 : 0,
			],
		);
		if (!row || typeof row.manifest_json !== 'string') {
			return null;
		}
		const manifest = pluginManifest(JSON.parse(row.manifest_json));
		if (manifest.id !== reference.packageId || manifest.version !== reference.version) {
			throw new Error('App code package identity mismatch');
		}
		return manifest;
	};

	const root = await readManifest(binding.app);
	if (
		!root?.contributions.app ||
		root.backendEntry === null ||
		root.compatibility.backendSdk !== Number(AGENT_PLUGIN_SDK_VERSION)
	) {
		return null;
	}
	const codeDependencies: StoredPluginPackageReference[] = [];
	const visited = new Set([binding.app.packageId]);
	const pending = root.dependencies.map((dependency) => dependency);
	while (pending.length) {
		const dependency = pending.pop();
		if (dependency === undefined) {
			continue;
		}
		const reference =
			dependency.packageId === binding.app.packageId
				? binding.app
				: binding.dependencies.find((reference) => reference.packageId === dependency.packageId);
		// Every signed edge must match, including an edge to an already visited package.
		if (
			!reference ||
			reference.publisherKeyId !== dependency.publisherKeyId ||
			!semver.satisfies(reference.version, '>=' + dependency.minVersion + ' <=' + dependency.maxVersion)
		) {
			return null;
		}
		if (visited.has(reference.packageId)) {
			continue;
		}
		visited.add(reference.packageId);
		const manifest = await readManifest(reference);
		if (!manifest) {
			return null;
		}
		codeDependencies.push({
			packageId: reference.packageId,
			version: reference.version,
			packageHash: reference.packageHash,
			publisherKeyId: reference.publisherKeyId,
		});
		pending.push(...manifest.dependencies.map((dependency) => dependency));
	}
	return {
		package: {
			packageId: binding.app.packageId,
			version: binding.app.version,
			packageHash: binding.app.packageHash,
			publisherKeyId: binding.app.publisherKeyId,
		},
		codeDependencies: codeDependencies.sort((a, b) => a.packageId.localeCompare(b.packageId)),
		handler: root.contributions.app.entry,
	};
}
