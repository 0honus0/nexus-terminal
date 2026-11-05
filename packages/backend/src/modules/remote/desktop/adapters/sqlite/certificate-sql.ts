import { isRdpCertificateFingerprint } from '@nexus-terminal/shared/remote/desktop/values';
import { TARGET_CONNECTION_HOST_MAX_BYTES } from '@nexus-terminal/shared/targets/connections/values';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import {
	CertificateTrustStorageConflict,
	type CertificateTrustStorage,
	type ConfirmCertificateTrust,
	type StoredCertificateTrust,
} from '../../storage/certificate-storage.js';

export function readCertificateTrustRow(row: SqlRow): StoredCertificateTrust {
	if (
		typeof row.user_id !== 'number' ||
		!Number.isSafeInteger(row.user_id) ||
		row.user_id < 1 ||
		typeof row.host !== 'string' ||
		!row.host.length ||
		row.host !== row.host.toLowerCase() ||
		Buffer.byteLength(row.host) > TARGET_CONNECTION_HOST_MAX_BYTES ||
		/[\s\u0000-\u001f\u007f]/u.test(row.host) ||
		typeof row.port !== 'number' ||
		!Number.isInteger(row.port) ||
		row.port < 1 ||
		row.port > 65535 ||
		!isRdpCertificateFingerprint(row.fingerprint) ||
		typeof row.confirmed_at !== 'number' ||
		!Number.isSafeInteger(row.confirmed_at) ||
		row.confirmed_at < 0
	) {
		throw new Error('Corrupt desktop certificate trust');
	}
	return {
		userId: row.user_id,
		host: row.host,
		port: row.port,
		fingerprint: row.fingerprint,
		confirmedAt: row.confirmed_at,
	};
}

export class SqliteCertificateTrustStorage implements CertificateTrustStorage {
	private readIdentity: ((tx: SqlExecutor, digest: string) => Promise<number | null>) | null = null;

	constructor(private readonly db: SqliteRuntime) {}

	installTransactionIdentityReader(read: (tx: SqlExecutor, digest: string) => Promise<number | null>): void {
		if (this.readIdentity) {
			throw new Error('Desktop certificate identity already installed');
		}
		this.readIdentity = read;
	}

	async get(userId: number, host: string, port: number): Promise<StoredCertificateTrust | null> {
		const row = await this.db.one(
			'SELECT user_id,host,port,fingerprint,confirmed_at FROM remote_desktop_certificates WHERE user_id=? AND host=? AND port=?',
			[userId, host, port],
		);
		return row ? readCertificateTrustRow(row) : null;
	}

	confirm(command: ConfirmCertificateTrust, digest: string, admit: (identity: number | null) => void): Promise<void> {
		return this.db.transaction(async (tx) => {
			if (!this.readIdentity) {
				throw new Error('Desktop certificate identity not installed');
			}
			admit(await this.readIdentity(tx, digest));
			const row = await tx.one(
				'SELECT user_id,host,port,fingerprint,confirmed_at FROM remote_desktop_certificates WHERE user_id=? AND host=? AND port=?',
				[command.userId, command.host, command.port],
			);
			const current = row ? readCertificateTrustRow(row) : null;
			if ((current?.fingerprint ?? null) !== command.previousFingerprint) {
				throw new CertificateTrustStorageConflict();
			}
			await tx.run(
				`INSERT INTO remote_desktop_certificates(user_id,host,port,fingerprint,confirmed_at) VALUES(?,?,?,?,?)
				ON CONFLICT(user_id,host,port) DO UPDATE SET fingerprint=excluded.fingerprint,confirmed_at=excluded.confirmed_at`,
				[command.userId, command.host, command.port, command.fingerprint, Date.now()],
			);
			admit(await this.readIdentity(tx, digest));
		});
	}
}
