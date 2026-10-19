import type { SqlRow } from '../worker-types.js';
import type { SnapshotFileReference } from '../snapshot-types.js';
import { SnapshotFailure } from '../snapshot-types.js';
import type { SecretBox } from '../../../security/secret-box.js';

export function snapshotIdentifier(value: string): string {
	if (!/^[a-z][a-z0-9_]*$/u.test(value)) {
		throw new SnapshotFailure('invalid_registration');
	}
	return '"' + value + '"';
}

export function transferSnapshotRow(
	row: SqlRow,
	columns: readonly string[],
	secretColumns: ReadonlyMap<string, string>,
	secrets: SecretBox | null,
): SqlRow {
	const result: SqlRow = {};
	for (const column of columns) {
		const value = row[column];
		const scope = secretColumns.get(column);
		if (scope && value !== null) {
			if (typeof value !== 'string' || !secrets) {
				throw new SnapshotFailure('unavailable');
			}
			result[column] = secrets.decrypt(value, scope);
		} else {
			result[column] = value;
		}
	}
	return result;
}

export function restoreSnapshotRow(
	row: SqlRow,
	columns: readonly string[],
	secretColumns: ReadonlyMap<string, string>,
	secrets: SecretBox | null,
): SqlRow {
	const result: SqlRow = {};
	for (const column of columns) {
		const value = row[column];
		const scope = secretColumns.get(column);
		if (scope) {
			result[column] = protectSnapshotSecret(value, scope, secrets);
		} else {
			result[column] = value;
		}
	}
	return result;
}

export function protectSnapshotSecret(value: unknown, scope: string, secrets: SecretBox | null): string | null {
	if (value === null) {
		return null;
	}
	if (typeof value !== 'string' || !value || Buffer.from(value, 'utf8').toString('utf8') !== value) {
		throw new SnapshotFailure('invalid_archive');
	}
	if (!secrets) {
		throw new SnapshotFailure('unavailable');
	}
	try {
		return secrets.encrypt(value, scope);
	} catch (cause) {
		throw new SnapshotFailure('unavailable', { cause });
	}
}

export function snapshotFile(root: string, row: SqlRow, hashColumn: string): SnapshotFileReference {
	if (typeof row.id !== 'string' || typeof row.size_bytes !== 'number' || typeof row[hashColumn] !== 'string') {
		throw new SnapshotFailure('unavailable');
	}
	return { root, key: row.id, bytes: row.size_bytes, sha256: row[hashColumn] };
}
