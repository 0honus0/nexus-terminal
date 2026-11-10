// Frozen published database migration dependency. Not an application API.
import type { SqlExecutor } from '../../../../../../../sql-types.js';

import { definitionComposition } from './definition-composition-row.js';

/** Converts package-keyed declarations to exact, retained per-user execution compositions. */
export async function bindScopeExecutionDeclarations(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE agent_app_definition_packages(
	 user_id INTEGER NOT NULL REFERENCES access_accounts(id) ON DELETE CASCADE,
	 definition_id TEXT NOT NULL,definition_version TEXT NOT NULL,package_id TEXT NOT NULL,
	 kind TEXT NOT NULL CHECK(kind IN ('app','tool')),version TEXT NOT NULL,package_hash TEXT NOT NULL,publisher_key_id TEXT NOT NULL,
	 PRIMARY KEY(user_id,definition_id,definition_version,package_id,kind),
	 FOREIGN KEY(definition_id,definition_version) REFERENCES agent_app_definitions(id,version) ON DELETE CASCADE,
	 FOREIGN KEY(user_id,package_id,version) REFERENCES agent_plugin_versions(user_id,definition_id,version));`);
	const definitions = await tx.all('SELECT * FROM agent_app_definitions ORDER BY id,version');
	for (const definition of definitions) {
		if (
			typeof definition.id !== 'string' ||
			typeof definition.version !== 'string' ||
			typeof definition.content_hash !== 'string' ||
			typeof definition.display_name !== 'string'
		) {
			throw new Error('Corrupt original App declaration');
		}
		const versions = await tx.all(
			'SELECT * FROM agent_plugin_versions WHERE definition_id=? AND version=? AND package_hash=? ORDER BY user_id',
			[definition.id, definition.version, definition.content_hash],
		);
		if (versions.length === 0) {
			throw new Error('Original App declaration package missing');
		}
		const capabilities = await tx.all(
			'SELECT capability FROM agent_app_declared_capabilities WHERE definition_id=? AND definition_version=? ORDER BY capability',
			[definition.id, definition.version],
		);
		for (const version of versions) {
			if (typeof version.user_id !== 'number' || typeof version.publisher_key_id !== 'string') {
				throw new Error('Corrupt original declaration ownership');
			}
			const composition = definitionComposition(version.user_id, [
				{
					packageId: definition.id,
					kind: 'app',
					version: definition.version,
					packageHash: definition.content_hash,
					publisherKeyId: version.publisher_key_id,
				},
			]);
			await tx.run('INSERT INTO agent_app_definitions(id,version,display_name,content_hash) VALUES(?,?,?,?)', [
				composition.id,
				definition.version,
				definition.display_name,
				composition.digest,
			]);
			await tx.run("INSERT INTO agent_app_definition_packages VALUES(?,?,?,?,'app',?,?,?)", [
				version.user_id,
				composition.id,
				definition.version,
				definition.id,
				definition.version,
				definition.content_hash,
				version.publisher_key_id,
			]);
			for (const capability of capabilities) {
				if (typeof capability.capability !== 'string') {
					throw new Error('Corrupt original declaration capability');
				}
				await tx.run('INSERT INTO agent_app_declared_capabilities VALUES(?,?,?)', [
					composition.id,
					definition.version,
					capability.capability,
				]);
			}
			await tx.run(
				'UPDATE agent_apps SET definition_id=? WHERE user_id=? AND definition_id=? AND definition_version=?',
				[composition.id, version.user_id, definition.id, definition.version],
			);
		}
		const remaining = await tx.one(
			'SELECT 1 FROM agent_apps WHERE definition_id=? AND definition_version=? LIMIT 1',
			[definition.id, definition.version],
		);
		if (remaining) {
			throw new Error('Original App declaration has an unbound owner');
		}
		await tx.run('DELETE FROM agent_app_declared_capabilities WHERE definition_id=? AND definition_version=?', [
			definition.id,
			definition.version,
		]);
		await tx.run('DELETE FROM agent_app_definitions WHERE id=? AND version=?', [definition.id, definition.version]);
	}
}
