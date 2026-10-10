import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { ConfirmHostKeyRecord, HostKeyRecord, HostKeyStorage } from '../../storage/host-key-storage.js';

function decode(row: Record<string, unknown>): HostKeyRecord {
	if (
		typeof row.host !== 'string' ||
		typeof row.fingerprint !== 'string' ||
		!row.host.length ||
		row.host !== row.host.toLowerCase() ||
		!/^SHA256:[A-Za-z0-9+/]{43}$/u.test(row.fingerprint) ||
		typeof row.port !== 'number' ||
		!Number.isSafeInteger(row.port) ||
		row.port < 1 ||
		row.port > 65535 ||
		typeof row.confirmed_at !== 'number' ||
		!Number.isSafeInteger(row.confirmed_at) ||
		row.confirmed_at < 0
	) {
		throw new Error('Corrupt SSH host trust');
	}
	return { host: row.host, port: row.port, fingerprint: row.fingerprint, confirmedAt: row.confirmed_at };
}

export class SqliteHostKeyStorage implements HostKeyStorage {
	constructor(private readonly db: SqliteRuntime) {}

	async list(): Promise<HostKeyRecord[]> {
		const rows = await this.db.all(
			'SELECT host,port,fingerprint,confirmed_at FROM target_host_keys ORDER BY host,port',
		);
		return rows.map(decode);
	}

	async confirm(command: ConfirmHostKeyRecord): Promise<HostKeyRecord> {
		return this.db.transaction(async (tx) => {
			const now = Date.now();
			await tx.run(
				`INSERT INTO target_host_keys(host,port,fingerprint,confirmed_at) VALUES(?,?,?,?)
				ON CONFLICT(host,port) DO UPDATE SET fingerprint=excluded.fingerprint,
					confirmed_at=excluded.confirmed_at`,
				[command.host, command.port, command.fingerprint, now],
			);
			const row = await tx.one(
				'SELECT host,port,fingerprint,confirmed_at FROM target_host_keys WHERE host=? AND port=?',
				[command.host, command.port],
			);
			if (!row) {
				throw new Error('Missing confirmed host key');
			}
			return decode(row);
		});
	}

	async remove(host: string, port: number): Promise<boolean> {
		const result = await this.db.run('DELETE FROM target_host_keys WHERE host=? AND port=?', [host, port]);
		return result.changes === 1;
	}
}
