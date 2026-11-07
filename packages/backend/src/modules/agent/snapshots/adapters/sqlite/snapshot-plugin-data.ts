import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import { SnapshotFailure } from '../../../../../platform/storage/sqlite/snapshot-types.js';
import { pluginDataRow } from '../../../plugins/adapters/sqlite/plugin-data-sql.js';
import { AGENT_ID_PATTERN } from '@nexus-terminal/shared/agent/values';

function key(row: SqlRow, extension: boolean, includeKey: boolean): string {
	if (
		typeof row.user_id !== 'number' ||
		!Number.isSafeInteger(row.user_id) ||
		row.user_id < 1 ||
		typeof row.app_id !== 'string' ||
		!AGENT_ID_PATTERN.test(row.app_id) ||
		(extension &&
			(typeof row.package_id !== 'string' || !/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/u.test(row.package_id)))
	) {
		throw new SnapshotFailure('unavailable');
	}
	return JSON.stringify([
		row.user_id,
		row.app_id,
		...(extension ? [row.package_id] : []),
		...(includeKey ? [row.key] : []),
	]);
}

/** Current values and idempotency tombstones are retained together; no historical row is filtered. */
export function validateSnapshotPluginData(rows: ReadonlyMap<string, readonly SqlRow[]>): void {
	const installations = new Set((rows.get('agent_plugin_installations') ?? []).map((row) => key(row, false, false)));
	const bindings = new Set((rows.get('agent_plugin_app_bindings') ?? []).map((row) => key(row, false, false)));
	const packages = new Set(
		(rows.get('agent_plugin_packages') ?? []).map((row) => JSON.stringify([row.user_id, row.package_id])),
	);
	for (const extension of [false, true]) {
		const dataTable = extension ? 'agent_plugin_extension_data' : 'agent_plugin_data';
		const operationTable = extension ? 'agent_plugin_extension_operations' : 'agent_plugin_data_operations';
		const data = new Map<string, SqlRow>();
		for (const row of rows.get(dataTable) ?? []) {
			pluginDataRow(row);
			const scope = key(row, extension, false);
			if (
				!(extension
					? bindings.has(key(row, false, false)) &&
						packages.has(JSON.stringify([row.user_id, row.package_id]))
					: installations.has(scope))
			) {
				throw new SnapshotFailure('unavailable');
			}
			const identity = key(row, extension, true);
			if (data.has(identity)) {
				throw new SnapshotFailure('unavailable');
			}
			data.set(identity, row);
		}
		const operationIds = new Set<string>();
		const activeKeys = new Set<string>();
		for (const row of rows.get(operationTable) ?? []) {
			pluginDataRow(row);
			const scope = key(row, extension, false);
			const identity = JSON.stringify([scope, row.operation_id]);
			if (
				!(extension
					? bindings.has(key(row, false, false)) &&
						packages.has(JSON.stringify([row.user_id, row.package_id]))
					: installations.has(scope)) ||
				typeof row.operation_id !== 'string' ||
				!AGENT_ID_PATTERN.test(row.operation_id) ||
				typeof row.content_hash !== 'string' ||
				!/^[a-f0-9]{64}$/u.test(row.content_hash) ||
				(row.retired !== 0 && row.retired !== 1) ||
				operationIds.has(identity) ||
				(row.retired === 1 && row.value_json !== null)
			) {
				throw new SnapshotFailure('unavailable');
			}
			operationIds.add(identity);
			if (row.retired === 0) {
				const dataKey = key(row, extension, true);
				const current = data.get(dataKey);
				if (
					!current ||
					activeKeys.has(dataKey) ||
					current.version !== row.version ||
					current.value_json !== row.value_json ||
					current.updated_at !== row.updated_at
				) {
					throw new SnapshotFailure('unavailable');
				}
				activeKeys.add(dataKey);
			}
		}
	}
}
