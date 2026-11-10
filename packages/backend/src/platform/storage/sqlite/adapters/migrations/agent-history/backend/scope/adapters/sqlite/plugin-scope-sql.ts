// Frozen published database migration dependency. Not an application API.
import { definitionComposition } from './definition-composition-row.js';

import { pluginManifest } from '../../../plugins/adapters/package/plugin-manifest.js';

import type { SqlExecutor } from '../../../../../../../sql-types.js';

import type { StoredPluginScopeActivation } from '../../storage/plugin-scope-storage.js';

import {
	initializeAppPolicy,
	invalidateAppPolicy,
	replaceAppGrants,
} from '../../../governance/adapters/sqlite/policy-write.js';

import type { StoredGrant } from '../../../governance/storage/governance-storage.js';

import { AGENT_TARGET_CAPABILITIES } from '../../../../contracts/governance/values.js';

import { cancelRunsInScope } from '../../../runs/adapters/sqlite/run-fence.js';

import { assertAppRevisionAvailable, readDefinition } from './app-row.js';

/** Participates in the installing owner's transaction; it alone writes Scope declarations and Apps. */
export async function activatePluginScope(tx: SqlExecutor, input: StoredPluginScopeActivation): Promise<void> {
	const grants: StoredGrant[] = (input.grantedCapabilities ?? []).map((capability) => ({
		capability,
		schemaVersion: 2,
		scope: AGENT_TARGET_CAPABILITIES.includes(capability)
			? { kind: 'targets', sshMode: 'all' }
			: { kind: 'global' },
		grantedAt: input.now,
	}));
	const composition = definitionComposition(input.userId, input.executionPackages);
	const appPackage = composition.packages.find((value) => value.kind === 'app');
	if (
		!appPackage ||
		appPackage.packageId !== input.definitionId ||
		appPackage.version !== input.definitionVersion ||
		appPackage.packageHash !== input.contentHash
	) {
		throw new Error('Execution declaration App provenance mismatch');
	}
	const declared = new Set<string>();
	for (const reference of composition.packages) {
		const row = await tx.one(
			'SELECT manifest_json FROM agent_plugin_versions WHERE user_id=? AND definition_id=? AND version=? AND package_hash=? AND publisher_key_id=?',
			[input.userId, reference.packageId, reference.version, reference.packageHash, reference.publisherKeyId],
		);
		if (typeof row?.manifest_json !== 'string') {
			throw new Error('Execution declaration package missing');
		}
		const manifest = pluginManifest(JSON.parse(row.manifest_json));
		if (
			manifest.id !== reference.packageId ||
			manifest.version !== reference.version ||
			(reference.kind === 'app' && manifest.contributions.app === null) ||
			(reference.kind === 'app' && manifest.displayName !== input.displayName)
		) {
			throw new Error('Execution declaration package mismatch');
		}
		for (const capability of manifest.capabilities) {
			declared.add(capability);
		}
	}
	const expectedCapabilities = [...declared].sort();
	if (
		input.grantedCapabilities !== null &&
		(new Set(input.grantedCapabilities).size !== input.grantedCapabilities.length ||
			input.grantedCapabilities.some((capability) => !declared.has(capability)))
	) {
		throw new Error('Undeclared execution grant');
	}
	if (
		new Set(input.capabilities).size !== input.capabilities.length ||
		JSON.stringify([...input.capabilities].sort()) !== JSON.stringify(expectedCapabilities)
	) {
		throw new Error('Execution declaration capability mismatch');
	}
	const definition = await tx.one('SELECT * FROM agent_app_definitions WHERE id=? AND version=?', [
		composition.id,
		input.definitionVersion,
	]);
	if (definition !== null) {
		const existing = await readDefinition(tx, definition);
		if (existing.userId !== input.userId || existing.sourcePackageId !== input.definitionId) {
			throw new Error('Execution declaration owner mismatch');
		}
		if (definition.content_hash !== composition.digest || definition.display_name !== input.displayName) {
			throw new Error('Immutable execution declaration conflict');
		}
		const previous = await tx.all(
			'SELECT capability FROM agent_app_declared_capabilities WHERE definition_id=? AND definition_version=? ORDER BY capability',
			[composition.id, input.definitionVersion],
		);
		if (JSON.stringify(previous.map((row) => row.capability)) !== JSON.stringify(expectedCapabilities)) {
			throw new Error('Immutable execution declaration capability conflict');
		}
	} else {
		await tx.run('INSERT INTO agent_app_definitions(id,version,display_name,content_hash) VALUES(?,?,?,?)', [
			composition.id,
			input.definitionVersion,
			input.displayName,
			composition.digest,
		]);
		for (const reference of composition.packages) {
			await tx.run(
				'INSERT INTO agent_app_definition_packages(user_id,definition_id,definition_version,package_id,kind,version,package_hash,publisher_key_id) VALUES(?,?,?,?,?,?,?,?)',
				[
					input.userId,
					composition.id,
					input.definitionVersion,
					reference.packageId,
					reference.kind,
					reference.version,
					reference.packageHash,
					reference.publisherKeyId,
				],
			);
		}
		for (const capability of expectedCapabilities) {
			await tx.run('INSERT INTO agent_app_declared_capabilities VALUES(?,?,?)', [
				composition.id,
				input.definitionVersion,
				capability,
			]);
		}
	}
	const current = await tx.one('SELECT user_id,definition_id,definition_version,version FROM agent_apps WHERE id=?', [
		input.appId,
	]);
	if (current !== null) {
		if (typeof current.definition_id !== 'string' || typeof current.definition_version !== 'string') {
			throw new Error('Corrupt current execution declaration');
		}
		const previousApp = await tx.one(
			"SELECT package_id FROM agent_app_definition_packages WHERE user_id=? AND definition_id=? AND definition_version=? AND kind='app'",
			[input.userId, current.definition_id, current.definition_version],
		);
		if (current.user_id !== input.userId || previousApp?.package_id !== input.definitionId) {
			throw new Error('Plugin App ownership conflict');
		}
		assertAppRevisionAvailable(current.version);
		// A version change never inherits a running lease. Only a confirmed onboarding install supplies new grants.
		await tx.run(
			'UPDATE agent_apps SET definition_id=?,definition_version=?,enabled=?,version=version+1,updated_at=? WHERE id=?',
			[composition.id, input.definitionVersion, input.enabled ? 1 : 0, input.now, input.appId],
		);
		// Optional provider replacement changes exact bindings, not the App's grants.
		// Its old approvals remain bound to the retired provider generation.
		if (input.mode !== 'provider') {
			await invalidateAppPolicy(tx, input.userId, input.appId);
		}
		if (input.grantedCapabilities !== null) {
			await replaceAppGrants(tx, input.userId, input.appId, grants);
		}
		if (input.mode === 'install') {
			await cancelRunsInScope(tx, input.userId, input.appId, input.now);
		}
	} else {
		await tx.run(
			'INSERT INTO agent_apps(id,user_id,name,definition_id,definition_version,enabled,version,updated_at,created_at) VALUES(?,?,?,?,?,?,1,?,?)',
			[
				input.appId,
				input.userId,
				input.displayName,
				composition.id,
				input.definitionVersion,
				input.enabled ? 1 : 0,
				input.now,
				input.now,
			],
		);
		await initializeAppPolicy(tx, input.userId, input.appId, grants);
	}
}
