import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import type { StoredPluginRuntimeObservation } from '../../storage/plugin-storage.js';

export function pluginRuntimeRow(row: SqlRow): StoredPluginRuntimeObservation {
	if (
		(row.unknown_at !== null &&
			(typeof row.unknown_at !== 'number' || !Number.isSafeInteger(row.unknown_at) || row.unknown_at < 0)) ||
		(row.acknowledged_at !== null &&
			(typeof row.acknowledged_at !== 'number' ||
				!Number.isSafeInteger(row.acknowledged_at) ||
				row.acknowledged_at < 0)) ||
		typeof row.app_id !== 'string' ||
		!row.app_id ||
		typeof row.instance_id !== 'string' ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(row.instance_id) ||
		typeof row.revision !== 'number' ||
		!Number.isSafeInteger(row.revision) ||
		row.revision < 1 ||
		typeof row.updated_at !== 'number' ||
		!Number.isSafeInteger(row.updated_at) ||
		row.updated_at < 0 ||
		(row.state !== 'opening' && row.state !== 'active' && row.state !== 'closed' && row.state !== 'unknown')
	) {
		throw new Error('Corrupt plugin runtime observation');
	}
	if (
		(row.state === 'unknown' && (row.unknown_at === null || row.acknowledged_at !== null)) ||
		(row.acknowledged_at !== null && (row.state !== 'closed' || row.unknown_at === null))
	) {
		throw new Error('Corrupt plugin runtime acknowledgement');
	}
	return {
		appId: row.app_id,
		instanceId: row.instance_id,
		revision: row.revision,
		state: row.state,
		updatedAt: row.updated_at,
		unknownAt: row.unknown_at,
		acknowledgedAt: row.acknowledged_at,
	};
}
