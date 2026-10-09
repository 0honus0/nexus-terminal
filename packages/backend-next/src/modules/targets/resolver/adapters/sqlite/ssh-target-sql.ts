import type { SqliteRuntime, SqlExecutor } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { SshTargetStorage, EncodedSshTarget } from '../../storage/ssh-target-storage.js';
import { SSH_MAX_JUMP_EDGES, SSH_MAX_EXPANDED_TARGETS } from '../../../connections/model/ssh-graph-limits.js';

function integer(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
		throw new Error('Corrupt target integer');
	return value;
}

function string(value: unknown): string {
	if (typeof value !== 'string') throw new Error('Corrupt target string');
	return value;
}

async function load(
	tx: SqlExecutor,
	id: number,
	path: Set<number>,
	depth: number,
	budget: { expanded: number },
): Promise<EncodedSshTarget> {
	if (path.has(id) || depth > SSH_MAX_JUMP_EDGES || ++budget.expanded > SSH_MAX_EXPANDED_TARGETS) {
		throw new Error('Invalid SSH jump chain');
	}
	const current = new Set(path);
	current.add(id);
	const row = await tx.one('SELECT id,type,host,port,username,route,proxy_id FROM connections WHERE id=?', [id]);
	if (!row) throw new Error('SSH target not found');
	if (row.type !== 'SSH') throw new Error('Target is not SSH');
	const cred = await tx.one(
		'SELECT auth_method,encrypted_password,ssh_key_id FROM connection_credentials WHERE connection_id=?',
		[id],
	);
	if (!cred) throw new Error('SSH credentials not configured');
	let credential: EncodedSshTarget['credential'];
	if (cred.auth_method === 'password' && typeof cred.encrypted_password === 'string' && cred.ssh_key_id === null)
		credential = { kind: 'password', ciphertext: cred.encrypted_password };
	else if (cred.auth_method === 'ssh_key' && cred.encrypted_password === null) {
		const keyId = integer(cred.ssh_key_id);
		const key = await tx.one('SELECT encrypted_private_key,encrypted_passphrase FROM ssh_keys WHERE id=?', [keyId]);
		if (!key) throw new Error('SSH key not found');
		credential = {
			kind: 'ssh_key',
			keyId,
			privateKey: string(key.encrypted_private_key),
			passphrase: key.encrypted_passphrase === null ? null : string(key.encrypted_passphrase),
		};
	} else throw new Error('Corrupt SSH authentication');
	let proxy: EncodedSshTarget['proxy'] = null;
	if (row.route === 'proxy') {
		const proxyId = integer(row.proxy_id);
		const p = await tx.one('SELECT id,type,host,port,username FROM proxies WHERE id=?', [proxyId]);
		if (
			!p ||
			!['SOCKS5', 'HTTP'].includes(String(p.type)) ||
			!(p.username === null || typeof p.username === 'string')
		)
			throw new Error('Proxy not found or corrupt');
		const pass = await tx.one('SELECT encrypted_password FROM proxy_credentials WHERE proxy_id=?', [proxyId]);
		proxy = {
			id: integer(p.id),
			type: p.type as 'SOCKS5' | 'HTTP',
			host: string(p.host),
			port: integer(p.port),
			username: p.username,
			ciphertext: pass ? string(pass.encrypted_password) : null,
		};
	} else if (row.route !== 'direct' && row.route !== 'jump') throw new Error('Invalid target route');
	const jumps: EncodedSshTarget[] = [];
	if (row.route === 'jump') {
		const chain = await tx.all(
			'SELECT jump_connection_id,position FROM connection_jumps WHERE connection_id=? ORDER BY position',
			[id],
		);
		if (!chain.length) throw new Error('SSH jump chain empty');
		for (let i = 0; i < chain.length; i++) {
			if (chain[i].position !== i) throw new Error('Invalid jump order');
			jumps.push(await load(tx, integer(chain[i].jump_connection_id), current, depth + 1, budget));
		}
	}
	return {
		id: integer(row.id),
		host: string(row.host),
		port: integer(row.port),
		username: string(row.username),
		credential,
		proxy,
		jumps,
	};
}

export class SqliteSshTargetStorage implements SshTargetStorage {
	constructor(private readonly db: SqliteRuntime) {}

	get(id: number) {
		return this.db.transaction((tx) => load(tx, id, new Set(), 0, { expanded: 0 }));
	}
}
