import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import type { PluginRepositoryStorage, StoredPluginRepositorySettings } from '../../storage/plugin-repository.js';
import { PluginStorageRefusal } from '../../storage/plugin-storage.js';
import { AGENT_PLUGIN_MAX_REPOSITORIES } from '@nexus-terminal/shared/agent/plugins/values';

function isRecord(input: unknown): input is Record<string, unknown> {
	return input !== null && typeof input === 'object' && !Array.isArray(input);
}

export function readRepositorySettings(row: SqlRow | null): StoredPluginRepositorySettings {
	if (row === null) {
		return { version: 0, repositories: [], updatedAt: 0 };
	}
	if (
		typeof row.version !== 'number' ||
		!Number.isSafeInteger(row.version) ||
		row.version < 1 ||
		typeof row.updated_at !== 'number' ||
		!Number.isSafeInteger(row.updated_at) ||
		row.updated_at < 0 ||
		typeof row.repositories_json !== 'string' ||
		Buffer.byteLength(row.repositories_json) > 128 * 1024
	) {
		throw new Error('Corrupt plugin repository settings');
	}
	const raw: unknown = JSON.parse(row.repositories_json);
	if (!Array.isArray(raw) || raw.length > AGENT_PLUGIN_MAX_REPOSITORIES) {
		throw new Error('Corrupt plugin repository list');
	}
	const repositories = raw.map((item) => {
		if (
			!isRecord(item) ||
			Object.keys(item).length !== 1 ||
			typeof item.url !== 'string' ||
			Buffer.byteLength(item.url) > 4096
		) {
			throw new Error('Corrupt plugin repository URL');
		}
		const url = new URL(item.url);
		if (
			!['http:', 'https:'].includes(url.protocol) ||
			url.username ||
			url.password ||
			url.hash ||
			url.href !== item.url
		) {
			throw new Error('Corrupt plugin repository URL');
		}
		return { url: item.url };
	});
	if (new Set(repositories.map((item) => item.url)).size !== repositories.length) {
		throw new Error('Duplicate plugin repositories');
	}
	return { version: row.version, repositories, updatedAt: row.updated_at };
}

export class SqlitePluginRepositoryStorage implements PluginRepositoryStorage {
	private identityReader: ((tx: SqlExecutor, digest: string) => Promise<number | null>) | null = null;

	constructor(private readonly db: SqliteRuntime) {}

	installIdentityReader(read: (tx: SqlExecutor, digest: string) => Promise<number | null>): void {
		if (this.identityReader) {
			throw new Error('Plugin repository identity already installed');
		}
		this.identityReader = read;
	}

	private identity(tx: SqlExecutor, digest: string): Promise<number | null> {
		if (this.identityReader === null) {
			throw new Error('Plugin repository identity missing');
		}
		return this.identityReader(tx, digest);
	}

	get(
		userId: number,
		digest: string,
		admit: (identity: number | null) => void,
	): Promise<StoredPluginRepositorySettings> {
		return this.db.transaction(async (tx) => {
			admit(await this.identity(tx, digest));
			return readRepositorySettings(
				await tx.one('SELECT * FROM agent_plugin_repositories WHERE user_id=?', [userId]),
			);
		});
	}

	put(
		userId: number,
		digest: string,
		expectedVersion: number,
		repositories: { url: string }[],
		now: number,
		admit: (identity: number | null, current: StoredPluginRepositorySettings) => void,
	): Promise<StoredPluginRepositorySettings> {
		return this.db.transaction(async (tx) => {
			const current = readRepositorySettings(
				await tx.one('SELECT * FROM agent_plugin_repositories WHERE user_id=?', [userId]),
			);
			admit(await this.identity(tx, digest), current);
			if (current.version !== expectedVersion) {
				throw new PluginStorageRefusal('version_conflict');
			}
			const version = current.version + 1;
			await tx.run(
				'INSERT INTO agent_plugin_repositories VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET version=excluded.version,repositories_json=excluded.repositories_json,updated_at=excluded.updated_at',
				[userId, version, JSON.stringify(repositories.map((item) => ({ url: item.url }))), now],
			);
			return { version, repositories: repositories.map((item) => ({ url: item.url })), updatedAt: now };
		});
	}
}
