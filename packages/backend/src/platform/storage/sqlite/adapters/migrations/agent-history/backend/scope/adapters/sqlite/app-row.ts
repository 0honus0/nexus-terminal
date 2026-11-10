// Frozen published database migration dependency. Not an application API.
import { definitionComposition, readDefinitionPackage } from './definition-composition-row.js';

import {
	AGENT_SCOPE_MAX_NAME_BYTES,
	AGENT_APP_DEFINITION_ID_PATTERN,
	AGENT_APP_MAX_DEFINITION_ID_BYTES,
	AGENT_APP_MAX_DEFINITION_VERSION_BYTES,
} from '../../../../contracts/scope/values.js';

import { AGENT_CAPABILITIES } from '../../../../contracts/governance/values.js';

import type { AgentCapability } from '../../../../contracts/governance/values.js';

import type { SqlReader } from '../../../../../../../sql-types.js';

import type { StoredDefinition } from '../../storage/scope-storage.js';

function text(value: unknown): string {
	if (typeof value !== 'string' || Buffer.from(value, 'utf8').toString('utf8') !== value) {
		throw new Error('Corrupt App text');
	}
	return value;
}

export async function readDefinition(tx: SqlReader, row: Record<string, unknown>): Promise<StoredDefinition> {
	const id = text(row.id);
	const version = text(row.version);
	const displayName = text(row.display_name);
	const contentHash = text(row.content_hash);
	if (
		!AGENT_APP_DEFINITION_ID_PATTERN.test(id) ||
		Buffer.byteLength(id, 'utf8') > AGENT_APP_MAX_DEFINITION_ID_BYTES ||
		!version.trim() ||
		Buffer.byteLength(version, 'utf8') > AGENT_APP_MAX_DEFINITION_VERSION_BYTES ||
		!displayName.trim() ||
		Buffer.byteLength(displayName, 'utf8') > AGENT_SCOPE_MAX_NAME_BYTES ||
		!/^[a-f0-9]{64}$/u.test(contentHash)
	) {
		throw new Error('Corrupt App declaration');
	}
	const packageRows = await tx.all(
		'SELECT * FROM agent_app_definition_packages WHERE definition_id=? AND definition_version=? ORDER BY kind,package_id',
		[id, version],
	);
	const owner = packageRows[0]?.user_id;
	if (typeof owner !== 'number' || packageRows.some((row) => row.user_id !== owner)) {
		throw new Error('Corrupt declaration owner');
	}
	const composition = definitionComposition(owner, packageRows.map(readDefinitionPackage));
	const appPackage = composition.packages.find((reference) => reference.kind === 'app');
	if (composition.id !== id || composition.digest !== contentHash || !appPackage || appPackage.version !== version) {
		throw new Error('Corrupt execution declaration identity');
	}
	return {
		userId: owner,
		sourcePackageId: appPackage.packageId,
		id,
		version,
		contentHash,
		displayName,
		capabilities: await capabilities(tx, id, version),
	};
}

function integer(value: unknown, minimum = 0): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
		throw new Error('Corrupt App integer');
	}
	return value;
}

export function assertAppRevisionAvailable(value: unknown): void {
	if (integer(value, 1) === Number.MAX_SAFE_INTEGER) {
		throw new Error('App revision exhausted');
	}
}

async function capabilities(tx: SqlReader, definitionId: string, version: string): Promise<AgentCapability[]> {
	const rows = await tx.all(
		'SELECT capability FROM agent_app_declared_capabilities WHERE definition_id=? AND definition_version=? ORDER BY capability LIMIT ?',
		[definitionId, version, AGENT_CAPABILITIES.length + 1],
	);
	if (rows.length > AGENT_CAPABILITIES.length) {
		throw new Error('Corrupt declared capability capacity');
	}
	return rows.map((row) => {
		const value = AGENT_CAPABILITIES.find((item) => item === row.capability);
		if (value === undefined) {
			throw new Error('Corrupt declared capability');
		}
		return value;
	});
}
