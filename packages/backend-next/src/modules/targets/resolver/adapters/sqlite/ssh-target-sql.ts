import { TargetFailure } from '../../../target-failure.js';
import type { SqliteRuntime, SqlExecutor } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { SshTargetStorage, EncodedSshTarget } from '../../storage/ssh-target-storage.js';
import { SSH_MAX_JUMP_EDGES, SSH_MAX_EXPANDED_TARGETS } from '../../../ssh-graph-limits.js';

function decodeInteger(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new Error('Corrupt target integer');
	}
	return value;
}

function decodeString(value: unknown): string {
	if (typeof value !== 'string') {
		throw new Error('Corrupt target string');
	}
	return value;
}

async function readCredential(tx: SqlExecutor, id: number): Promise<EncodedSshTarget['credential']> {
	const credentialRow = await tx.one(
		'SELECT auth_method,encrypted_password,ssh_key_id FROM connection_credentials WHERE connection_id=?',
		[id],
	);
	if (!credentialRow) {
		throw new TargetFailure('unresolvable');
	}
	let credential: EncodedSshTarget['credential'];
	if (
		credentialRow.auth_method === 'password' &&
		typeof credentialRow.encrypted_password === 'string' &&
		credentialRow.ssh_key_id === null
	) {
		credential = { kind: 'password', ciphertext: credentialRow.encrypted_password };
	} else if (credentialRow.auth_method === 'ssh_key' && credentialRow.encrypted_password === null) {
		const keyId = decodeInteger(credentialRow.ssh_key_id);
		const key = await tx.one('SELECT encrypted_private_key,encrypted_passphrase FROM ssh_keys WHERE id=?', [keyId]);
		if (!key) {
			throw new TargetFailure('reference_not_found');
		}
		credential = {
			kind: 'ssh_key',
			keyId,
			privateKey: decodeString(key.encrypted_private_key),
			passphrase: key.encrypted_passphrase === null ? null : decodeString(key.encrypted_passphrase),
		};
	} else {
		throw new Error('Corrupt SSH authentication');
	}
	return credential;
}

async function readProxy(tx: SqlExecutor, proxyId: number): Promise<NonNullable<EncodedSshTarget['proxy']>> {
	const proxyRow = await tx.one('SELECT id,type,host,port,username FROM proxies WHERE id=?', [proxyId]);
	if (
		!proxyRow ||
		(proxyRow.type !== 'SOCKS5' && proxyRow.type !== 'HTTP') ||
		!(proxyRow.username === null || typeof proxyRow.username === 'string')
	) {
		throw new Error('Proxy not found or corrupt');
	}
	const passwordRow = await tx.one('SELECT encrypted_password FROM proxy_credentials WHERE proxy_id=?', [proxyId]);
	return {
		id: decodeInteger(proxyRow.id),
		type: proxyRow.type,
		host: decodeString(proxyRow.host),
		port: decodeInteger(proxyRow.port),
		username: proxyRow.username,
		ciphertext: passwordRow ? decodeString(passwordRow.encrypted_password) : null,
	};
}

async function loadTargetSnapshot(
	tx: SqlExecutor,
	id: number,
	path: Set<number>,
	depth: number,
	budget: { expanded: number },
): Promise<EncodedSshTarget> {
	if (path.has(id) || depth > SSH_MAX_JUMP_EDGES || ++budget.expanded > SSH_MAX_EXPANDED_TARGETS) {
		throw new TargetFailure('invalid_input');
	}
	const current = new Set(path);
	current.add(id);
	const row = await tx.one('SELECT id,type,host,port,username,route,proxy_id FROM connections WHERE id=?', [id]);
	if (!row) {
		throw new TargetFailure('reference_not_found');
	}
	if (row.type !== 'SSH') {
		throw new TargetFailure('unresolvable');
	}
	const credential = await readCredential(tx, id);
	let proxy: EncodedSshTarget['proxy'] = null;
	if (row.route === 'proxy') {
		proxy = await readProxy(tx, decodeInteger(row.proxy_id));
	} else if (row.route !== 'direct' && row.route !== 'jump') {
		throw new TargetFailure('unresolvable');
	}
	const jumps: EncodedSshTarget[] = [];
	if (row.route === 'jump') {
		const chain = await tx.all(
			'SELECT jump_connection_id,position FROM connection_jumps WHERE connection_id=? ORDER BY position',
			[id],
		);
		if (!chain.length) {
			throw new TargetFailure('unresolvable');
		}
		for (let i = 0; i < chain.length; i++) {
			if (chain[i].position !== i) {
				throw new TargetFailure('unresolvable');
			}
			jumps.push(
				await loadTargetSnapshot(tx, decodeInteger(chain[i].jump_connection_id), current, depth + 1, budget),
			);
		}
	}
	return {
		id: decodeInteger(row.id),
		host: decodeString(row.host),
		port: decodeInteger(row.port),
		username: decodeString(row.username),
		credential,
		proxy,
		jumps,
	};
}

export class SqliteSshTargetStorage implements SshTargetStorage {
	constructor(private readonly db: SqliteRuntime) {}

	get(id: number): Promise<EncodedSshTarget> {
		return this.db.transaction((tx) => loadTargetSnapshot(tx, id, new Set(), 0, { expanded: 0 }));
	}
}
