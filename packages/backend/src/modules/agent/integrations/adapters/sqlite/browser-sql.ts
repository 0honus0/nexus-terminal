import type { SqlExecutor, SqlReader } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { StoredBrowserTarget, StoredBrowserConfiguration, BrowserStorage } from '../../storage/browser-storage.js';
import { BrowserStorageRefusal } from '../../storage/browser-storage.js';
import {
	AGENT_BROWSER_MAX_BODY_BYTES,
	AGENT_BROWSER_MAX_TARGETS,
	AGENT_BROWSER_MAX_ENDPOINTS,
	AGENT_BROWSER_ENDPOINT_MAX_BYTES,
	AGENT_BROWSER_MAX_PATTERNS,
	AGENT_BROWSER_PATTERN_MAX_BYTES,
	AGENT_BROWSER_MAX_PRIORITY,
	AGENT_BROWSER_TARGET_ID_MAX_BYTES,
} from '@nexus-terminal/shared/agent/integrations/browser-values';

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function targets(encoded: unknown): StoredBrowserTarget[] {
	if (typeof encoded !== 'string' || Buffer.byteLength(encoded, 'utf8') > AGENT_BROWSER_MAX_BODY_BYTES) {
		throw new Error('Corrupt browser settings');
	}
	const value: unknown = JSON.parse(encoded);
	if (!Array.isArray(value) || value.length > AGENT_BROWSER_MAX_TARGETS) {
		throw new Error('Corrupt browser targets');
	}
	const result = value.map((row) => {
		if (
			!record(row) ||
			Object.keys(row).length !== 3 ||
			typeof row.id !== 'string' ||
			!/^[a-z][a-z0-9_-]*$/u.test(row.id) ||
			Buffer.byteLength(row.id, 'utf8') > AGENT_BROWSER_TARGET_ID_MAX_BYTES ||
			!Array.isArray(row.endpoints) ||
			row.endpoints.length < 1 ||
			row.endpoints.length > AGENT_BROWSER_MAX_ENDPOINTS ||
			!Array.isArray(row.allowedUrlPatterns) ||
			row.allowedUrlPatterns.length < 1 ||
			row.allowedUrlPatterns.length > AGENT_BROWSER_MAX_PATTERNS
		) {
			throw new Error('Corrupt browser target');
		}
		const endpoints = row.endpoints.map((item) => {
			if (
				!record(item) ||
				Object.keys(item).length !== 4 ||
				typeof item.url !== 'string' ||
				Buffer.byteLength(item.url, 'utf8') > AGENT_BROWSER_ENDPOINT_MAX_BYTES ||
				typeof item.priority !== 'number' ||
				!Number.isSafeInteger(item.priority) ||
				item.priority < 0 ||
				item.priority > AGENT_BROWSER_MAX_PRIORITY ||
				typeof item.allowPlaintext !== 'boolean' ||
				typeof item.verifyTls !== 'boolean'
			) {
				throw new Error('Corrupt browser endpoint');
			}
			const url = new URL(item.url);
			if (
				!['ws:', 'wss:'].includes(url.protocol) ||
				url.username ||
				url.password ||
				url.hash ||
				url.href !== item.url ||
				(url.protocol === 'ws:' && !item.allowPlaintext)
			) {
				throw new Error('Corrupt browser endpoint URL');
			}
			return {
				url: item.url,
				priority: item.priority,
				allowPlaintext: item.allowPlaintext,
				verifyTls: item.verifyTls,
			};
		});
		const patterns = row.allowedUrlPatterns.map((item) => {
			if (typeof item !== 'string' || Buffer.byteLength(item, 'utf8') > AGENT_BROWSER_PATTERN_MAX_BYTES) {
				throw new Error('Corrupt browser pattern');
			}
			const url = new URL(item);
			if (
				!['http:', 'https:'].includes(url.protocol) ||
				url.username ||
				url.password ||
				url.hash ||
				url.search ||
				url.hostname.includes('*') ||
				url.href !== item ||
				(url.pathname.includes('*') &&
					(!url.pathname.endsWith('*') || url.pathname.indexOf('*') !== url.pathname.length - 1))
			) {
				throw new Error('Corrupt browser page pattern');
			}
			return item;
		});
		return { id: row.id, endpoints, allowedUrlPatterns: patterns };
	});
	if (new Set(result.map((target) => target.id)).size !== result.length) {
		throw new Error('Duplicate browser target');
	}
	return result;
}

export async function initializeBrowserConfiguration(tx: SqlExecutor): Promise<void> {
	await tx.exec(
		'CREATE TABLE agent_browser_configuration(user_id INTEGER PRIMARY KEY REFERENCES access_accounts(id) ON DELETE CASCADE,version INTEGER NOT NULL CHECK(version>=1),targets_json TEXT NOT NULL)',
	);
}

export async function readBrowserConfiguration(tx: SqlReader, userId: number): Promise<StoredBrowserConfiguration> {
	const row = await tx.one('SELECT version,targets_json FROM agent_browser_configuration WHERE user_id=?', [userId]);
	if (!row) {
		return { version: 1, targets: [] };
	}
	if (typeof row.version !== 'number' || !Number.isSafeInteger(row.version) || row.version < 1) {
		throw new Error('Corrupt browser version');
	}
	return { version: row.version, targets: targets(row.targets_json) };
}

export class SqliteBrowserStorage implements BrowserStorage {
	private readIdentity: ((tx: SqlExecutor, digest: string) => Promise<number | null>) | null = null;

	constructor(private readonly db: SqliteRuntime) {}

	installTransactionIdentityReader(read: (tx: SqlExecutor, digest: string) => Promise<number | null>): void {
		if (this.readIdentity) {
			throw new Error('Browser identity already installed');
		}
		this.readIdentity = read;
	}

	get(userId: number): Promise<StoredBrowserConfiguration> {
		return readBrowserConfiguration(this.db, userId);
	}

	update(
		userId: number,
		digest: string,
		version: number,
		targets: StoredBrowserTarget[],
		admit: (identityUserId: number | null) => void,
	): Promise<StoredBrowserConfiguration> {
		return this.db.transaction(async (tx) => {
			if (!this.readIdentity) {
				throw new Error('Browser identity unavailable');
			}
			admit(await this.readIdentity(tx, digest));
			const current = await readBrowserConfiguration(tx, userId);
			if (current.version !== version || current.version === Number.MAX_SAFE_INTEGER) {
				throw new BrowserStorageRefusal('version_conflict');
			}
			await tx.run(
				'INSERT INTO agent_browser_configuration VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET version=excluded.version,targets_json=excluded.targets_json',
				[userId, version + 1, JSON.stringify(targets)],
			);
			return readBrowserConfiguration(tx, userId);
		});
	}
}
