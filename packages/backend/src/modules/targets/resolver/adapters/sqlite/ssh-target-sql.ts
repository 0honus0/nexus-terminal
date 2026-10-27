import { readConnectionCredentialRow } from '../../../connections/adapters/sqlite/connection-credential-sql.js';
import { readProxyCredentialRow, readProxyRow } from '../../../proxies/adapters/sqlite/proxy-management-sql.js';
import { readSshKeyRow } from '../../../ssh-keys/adapters/sqlite/ssh-key-sql.js';
import { readConnectionMetadataRow } from '../../../connections/adapters/sqlite/connection-sql.js';
import { TARGET_CONNECTION_MAX_JUMPS } from '@nexus-terminal/shared/targets/connections/values';
import { SshTargetStorageRefusal } from '../../storage/ssh-target-storage.js';
import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { SshTargetStorage, EncodedSshTarget } from '../../storage/ssh-target-storage.js';
import type { SshReferenceLookup, EncodedSshReferences } from '../../storage/ssh-target-storage.js';
import type { SshSnapshotLimits } from '../../storage/ssh-target-storage.js';

function decodeInteger(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) {
		throw new Error('Corrupt target integer');
	}
	return value;
}

function decodeString(value: unknown, maxBytes = Number.MAX_SAFE_INTEGER): string {
	if (
		typeof value !== 'string' ||
		Buffer.byteLength(value, 'utf8') > maxBytes ||
		Buffer.from(value, 'utf8').toString('utf8') !== value
	) {
		throw new Error('Corrupt target string');
	}
	return value;
}

async function readKey(tx: SqlExecutor, id: number): Promise<NonNullable<EncodedSshReferences['key']>> {
	const row = await tx.one('SELECT * FROM ssh_keys WHERE id=?', [id]);
	if (!row) {
		throw new SshTargetStorageRefusal('missing_reference');
	}
	readSshKeyRow(row);
	return {
		privateKey: decodeString(row.encrypted_private_key),
		passphrase: row.encrypted_passphrase === null ? null : decodeString(row.encrypted_passphrase),
	};
}

async function readCredential(tx: SqlExecutor, id: number): Promise<EncodedSshTarget['credential']> {
	const credentialRow = await tx.one(
		'SELECT connection_id,auth_method,encrypted_password,ssh_key_id,updated_at FROM connection_credentials WHERE connection_id=?',
		[id],
	);
	if (!credentialRow) {
		throw new SshTargetStorageRefusal('missing_credential');
	}
	const stored = readConnectionCredentialRow(credentialRow);
	if (stored.kind === 'password') {
		return { kind: 'password', ciphertext: stored.encryptedPassword };
	}
	const key = await readKey(tx, stored.sshKeyId);
	const credential: EncodedSshTarget['credential'] = {
		kind: 'ssh_key',
		keyId: stored.sshKeyId,
		privateKey: key.privateKey,
		passphrase: key.passphrase,
	};
	return credential;
}

async function readProxy(tx: SqlExecutor, proxyId: number): Promise<NonNullable<EncodedSshTarget['proxy']>> {
	const proxyRow = await tx.one('SELECT * FROM proxies WHERE id=?', [proxyId]);
	if (!proxyRow) {
		throw new SshTargetStorageRefusal('missing_reference');
	}
	const proxy = readProxyRow(proxyRow);
	const passwordRow = await tx.one(
		'SELECT proxy_id,encrypted_password,updated_at FROM proxy_credentials WHERE proxy_id=?',
		[proxyId],
	);
	return {
		id: proxy.id,
		type: proxy.type,
		host: proxy.host,
		port: proxy.port,
		username: proxy.username,
		ciphertext: passwordRow ? readProxyCredentialRow(passwordRow).encryptedPassword : null,
	};
}

async function loadTargetSnapshot(
	tx: SqlExecutor,
	id: number,
	path: Set<number>,
	depth: number,
	budget: { expanded: number },
	limits: SshSnapshotLimits,
): Promise<EncodedSshTarget> {
	if (path.has(id) || depth > limits.maxDepth || ++budget.expanded > limits.maxExpanded) {
		throw new SshTargetStorageRefusal('invalid_graph');
	}
	const current = new Set(path);
	current.add(id);
	const row = await tx.one('SELECT * FROM connections WHERE id=?', [id]);
	if (!row) {
		throw new SshTargetStorageRefusal('missing_reference');
	}
	const connection = readConnectionMetadataRow(row);
	if (connection.type !== 'SSH') {
		throw new SshTargetStorageRefusal('unsupported_target');
	}
	const credential = await readCredential(tx, id);
	let proxy: EncodedSshTarget['proxy'] = null;
	if (connection.route === 'proxy') {
		proxy = await readProxy(tx, decodeInteger(connection.proxyId));
	}
	const jumps: EncodedSshTarget[] = [];
	if (connection.route === 'jump') {
		const chain = await tx.all(
			'SELECT jump_connection_id,position FROM connection_jumps WHERE connection_id=? ORDER BY position',
			[id],
		);
		if (!chain.length || chain.length > TARGET_CONNECTION_MAX_JUMPS) {
			throw new SshTargetStorageRefusal('invalid_graph');
		}
		for (let i = 0; i < chain.length; i++) {
			if (chain[i].position !== i) {
				throw new SshTargetStorageRefusal('invalid_graph');
			}
			jumps.push(
				await loadTargetSnapshot(
					tx,
					decodeInteger(chain[i].jump_connection_id),
					current,
					depth + 1,
					budget,
					limits,
				),
			);
		}
	}
	return {
		id: connection.id,
		host: connection.host,
		port: connection.port,
		username: connection.username,
		credential,
		proxy,
		jumps,
	};
}

export class SqliteSshTargetStorage implements SshTargetStorage {
	constructor(private readonly db: SqliteRuntime) {}

	get(id: number, limits: SshSnapshotLimits): Promise<EncodedSshTarget> {
		return this.db.transaction((tx) => loadTargetSnapshot(tx, id, new Set(), 0, { expanded: 0 }, limits));
	}

	references(request: SshReferenceLookup, limits: SshSnapshotLimits): Promise<EncodedSshReferences> {
		return this.db.transaction(async (tx) => {
			let key: EncodedSshReferences['key'] = null;
			if (request.sshKeyId !== null) {
				key = await readKey(tx, request.sshKeyId);
			}
			const proxy = request.proxyId === null ? null : await readProxy(tx, request.proxyId);
			const jumps: EncodedSshTarget[] = [];
			const budget = { expanded: 1 };
			for (const id of request.jumpIds) {
				jumps.push(await loadTargetSnapshot(tx, id, new Set(), 1, budget, limits));
			}
			return { key, proxy, jumps };
		});
	}
}
