import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import { ConnectionTagStorageRefusal } from '../../storage/connection-tag-storage.js';
import type { ConnectionTagWrite, ValidateConnectionTagCount } from '../../storage/connection-tag-storage.js';

function readCount(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new Error('Corrupt connection tag count');
	}
	return value;
}

/** Validate every referenced connection and resulting membership before any write. */
export async function assignConnectionTag(
	tx: SqlExecutor,
	command: ConnectionTagWrite,
	replace: boolean,
	validateCount: ValidateConnectionTagCount,
): Promise<void> {
	const { tagId, connectionIds } = command;
	const slots = connectionIds.map(() => '?').join(',');
	if (connectionIds.length > 0) {
		const rows = await tx.all(
			'SELECT c.id,COUNT(ct.tag_id) AS tag_count,MAX(CASE WHEN ct.tag_id=? THEN 1 ELSE 0 END) AS has_tag FROM connections c LEFT JOIN connection_tags ct ON ct.connection_id=c.id WHERE c.id IN (' +
				slots +
				') GROUP BY c.id',
			[tagId, ...connectionIds],
		);
		if (rows.length !== connectionIds.length) {
			throw new ConnectionTagStorageRefusal();
		}
		for (const row of rows) {
			const hasTag = readCount(row.has_tag);
			if (hasTag > 1) {
				throw new Error('Corrupt connection tag membership');
			}
			validateCount(readCount(row.tag_count) + (hasTag === 0 ? 1 : 0));
		}
	}
	const now = Date.now();
	if (replace) {
		const excluded = connectionIds.length === 0 ? '' : ' AND connection_id NOT IN (' + slots + ')';
		const params = [tagId, ...connectionIds];
		await tx.run(
			'UPDATE connections SET version=version+1,updated_at=? WHERE id IN (SELECT connection_id FROM connection_tags WHERE tag_id=?' +
				excluded +
				')',
			[now, ...params],
		);
		await tx.run('DELETE FROM connection_tags WHERE tag_id=?' + excluded, params);
	}
	if (connectionIds.length === 0) {
		return;
	}
	await tx.run(
		'UPDATE connections SET version=version+1,updated_at=? WHERE id IN (' +
			slots +
			') AND NOT EXISTS (SELECT 1 FROM connection_tags WHERE connection_id=connections.id AND tag_id=?)',
		[now, ...connectionIds, tagId],
	);
	await tx.run(
		'INSERT INTO connection_tags(connection_id,tag_id) VALUES ' +
			connectionIds.map(() => '(?,?)').join(',') +
			' ON CONFLICT(connection_id,tag_id) DO NOTHING',
		connectionIds.flatMap((id) => [id, tagId]),
	);
}

export async function detachConnectionTag(tx: SqlExecutor, tagId: number): Promise<void> {
	await tx.run(
		'UPDATE connections SET version=version+1,updated_at=? WHERE id IN (SELECT connection_id FROM connection_tags WHERE tag_id=?)',
		[Date.now(), tagId],
	);
	await tx.run('DELETE FROM connection_tags WHERE tag_id=?', [tagId]);
}
