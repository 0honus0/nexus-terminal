import { pluginTrust } from '../../../plugins/adapters/sqlite/plugin-trust-sql.js';
import { AGENT_ID_PATTERN } from '@nexus-terminal/shared/agent/values';
import {
	AGENT_SCOPE_MAX_NAME_BYTES,
	AGENT_APP_DEFINITION_ID_PATTERN,
	AGENT_APP_MAX_DEFINITION_ID_BYTES,
	AGENT_APP_MAX_DEFINITION_VERSION_BYTES,
} from '@nexus-terminal/shared/agent/scope/values';
import { AGENT_CAPABILITIES } from '@nexus-terminal/shared/agent/governance/values';
import type { AgentCapability } from '@nexus-terminal/shared/agent/governance/values';
import type { SqlReader } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { AppRecord, StoredAppAuthority } from '../../storage/scope-storage.js';

function text(value: unknown): string {
	if (typeof value !== 'string') {
		throw new Error('Corrupt App text');
	}
	return value;
}

function integer(value: unknown, minimum = 0): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
		throw new Error('Corrupt App integer');
	}
	return value;
}

function boolean(value: unknown): boolean {
	if (value !== 0 && value !== 1) {
		throw new Error('Corrupt App flag');
	}
	return value === 1;
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

export async function readApp(tx: SqlReader, row: Record<string, unknown>): Promise<AppRecord> {
	const definitionId = text(row.definition_id);
	const definitionVersion = text(row.definition_version);
	const definition = await tx.one(
		'SELECT installed,source_kind FROM agent_app_definitions WHERE id=? AND version=?',
		[definitionId, definitionVersion],
	);
	if (definition === null) {
		throw new Error('Missing App declaration');
	}
	const declared =
		boolean(definition.installed) &&
		(definition.source_kind === 'builtin' ||
			(definition.source_kind === 'plugin' &&
				(await pluginTrust(tx, integer(row.user_id, 1), text(row.id), definitionVersion))));
	const enabled = boolean(row.enabled);
	if (enabled && !declared) {
		throw new Error('Enabled App has no installed declaration');
	}
	const id = text(row.id);
	const name = text(row.name);
	if (
		!AGENT_ID_PATTERN.test(id) ||
		!name.trim() ||
		Buffer.byteLength(name, 'utf8') > AGENT_SCOPE_MAX_NAME_BYTES ||
		!AGENT_APP_DEFINITION_ID_PATTERN.test(definitionId) ||
		Buffer.byteLength(definitionId, 'utf8') > AGENT_APP_MAX_DEFINITION_ID_BYTES ||
		!definitionVersion.trim() ||
		Buffer.byteLength(definitionVersion, 'utf8') > AGENT_APP_MAX_DEFINITION_VERSION_BYTES
	) {
		throw new Error('Corrupt App identity');
	}
	const createdAt = integer(row.created_at);
	const updatedAt = integer(row.updated_at);
	if (updatedAt < createdAt) {
		throw new Error('Corrupt App timestamps');
	}
	return {
		definitionInstalled: declared,
		id,
		userId: integer(row.user_id, 1),
		name,
		definitionId,
		definitionVersion,
		capabilities: declared ? await capabilities(tx, definitionId, definitionVersion) : [],
		enabled,
		version: integer(row.version, 1),
		createdAt,
		updatedAt,
	};
}

export async function appAuthority(tx: SqlReader, userId: number, appId: string): Promise<StoredAppAuthority | null> {
	const row = await tx.one('SELECT * FROM agent_apps WHERE user_id=? AND id=?', [userId, appId]);
	if (row === null) {
		return null;
	}
	const app = await readApp(tx, row);
	return {
		enabled: app.enabled,
		declared: app.definitionInstalled,
		capabilities: app.capabilities.map((capability) => capability),
	};
}
