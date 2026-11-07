import { historicalToolHostOperation } from '../../../runs/adapters/sqlite/run-tool-identity-migration.js';
import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import { SnapshotFailure } from '../../../../../platform/storage/sqlite/snapshot-types.js';
import { readToolChild } from '../../../runs/adapters/sqlite/run-tool-parent-sql.js';
import { readToolOperation } from '../../../runs/adapters/sqlite/run-tool-row.js';
import type { StoredToolChildRelation } from '../../../runs/storage/run-tool-storage.js';
import { pluginToolName } from '../../../plugins/plugin-tool-authority-rules.js';
import { hostOperationDefinition, isAcpExecutionOperation } from '../../../tools/host-operation-rules.js';
import { snapshotPluginVersion, snapshotVersionKey } from './snapshot-plugin-versions.js';

/** Check immutable provenance without requiring an historical parent to remain dispatched. */
export function validateSnapshotToolChildren(rows: ReadonlyMap<string, readonly SqlRow[]>): void {
	const tools = new Map((rows.get('agent_run_tools') ?? []).map((row) => [row.id, row]));
	const versions = new Map(
		(rows.get('agent_plugin_versions') ?? []).map((row) => [
			JSON.stringify([row.user_id, row.definition_id, row.version]),
			row,
		]),
	);
	const archives = new Map(
		(rows.get('agent_plugin_legacy_versions') ?? []).map((row) => [snapshotVersionKey(row), row]),
	);
	const runtimes = new Map<unknown, SqlRow>();
	for (const table of ['agent_plugin_runtime_instances', 'agent_plugin_runtime_history']) {
		for (const row of rows.get(table) ?? []) {
			if (runtimes.has(row.instance_id)) {
				throw new SnapshotFailure('unavailable');
			}
			runtimes.set(row.instance_id, row);
		}
	}
	const relations = new Map<string, StoredToolChildRelation>();
	const requests = new Set<string>();
	for (const row of rows.get('agent_tool_children') ?? []) {
		const relation = readToolChild(row);
		const child = tools.get(relation.toolId),
			parent = tools.get(relation.parentId);
		const request = JSON.stringify([relation.parentId, relation.requestKey]);
		if (
			!child ||
			!parent ||
			relations.has(relation.toolId) ||
			requests.has(request) ||
			child.user_id !== parent.user_id ||
			child.app_id !== parent.app_id ||
			child.run_id !== parent.run_id ||
			child.model_step_index !== parent.model_step_index ||
			relation.parentHash !== parent.operation_hash ||
			relation.requestKey !== child.provider_call_id
		) {
			throw new SnapshotFailure('unavailable');
		}
		relations.set(relation.toolId, relation);
		requests.add(request);
		const childOperation = readToolOperation(child),
			parentOperation = readToolOperation(parent);
		if (relation.kind === 'acp_permission') {
			if (
				childOperation.identity.kind !== 'host' ||
				childOperation.identity.operation !== 'acp.permission' ||
				parentOperation.identity.kind !== 'host' ||
				!isAcpExecutionOperation(parentOperation.identity.operation) ||
				child.target_id !== parent.target_id ||
				child.target_version !== parent.target_version ||
				child.capability !== parent.capability
			) {
				throw new SnapshotFailure('unavailable');
			}
		} else {
			const authority = relation.plugin;
			const prefix = authority.packageId + '@';
			if (
				childOperation.identity.kind !== 'host' ||
				childOperation.identity.operation === 'acp.permission' ||
				childOperation.toolName !== childOperation.identity.operation ||
				childOperation.toolVersion !== '1' ||
				((childOperation.identity.operation === 'remote.readTextPage' ||
					childOperation.identity.operation === 'remote.listPage') &&
					childOperation.targetId === null) ||
				parentOperation.identity.kind !== 'plugin' ||
				parentOperation.identity.packageId !== authority.packageId ||
				typeof parent.tool_version !== 'string' ||
				!parent.tool_version.startsWith(prefix)
			) {
				throw new SnapshotFailure('unavailable');
			}
			const split = parent.tool_version.lastIndexOf('#');
			if (split <= prefix.length) {
				throw new SnapshotFailure('unavailable');
			}
			const version = versions.get(
				JSON.stringify([parent.user_id, authority.packageId, parent.tool_version.slice(prefix.length, split)]),
			);
			if (!version || version.package_hash !== parent.tool_version.slice(split + 1)) {
				throw new SnapshotFailure('unavailable');
			}
			const { manifest, toolNames } = snapshotPluginVersion(version, archives.get(snapshotVersionKey(version)));
			const parentIdentity = parentOperation.identity;
			if (
				parentIdentity.kind !== 'plugin' ||
				parentIdentity.packageVersion !== version.version ||
				parentIdentity.packageSha256 !== version.package_hash ||
				!toolNames.includes(parentIdentity.name) ||
				parentOperation.toolName !== pluginToolName(authority.packageId, parentIdentity.name)
			) {
				throw new SnapshotFailure('unavailable');
			}
			// This table is a read-only SDK1–3 archive. SDK4 calls belong to agent_operations.
			if (manifest !== null) {
				throw new SnapshotFailure('unavailable');
			}

			const runtime = runtimes.get(authority.instanceId);
			// Normal runtime retention prunes closed instances; a surviving row must match exactly.
			if (
				runtime &&
				(runtime.user_id !== parent.user_id ||
					runtime.app_id !== parent.app_id ||
					runtime.package_id !== authority.packageId ||
					runtime.revision !== authority.instanceRevision)
			) {
				throw new SnapshotFailure('unavailable');
			}
		}
	}
	for (const tool of tools.values()) {
		const operation = readToolOperation(tool);
		if (operation.identity.kind === 'plugin') {
			const identity = operation.identity;
			const version = versions.get(
				JSON.stringify([operation.userId, identity.packageId, identity.packageVersion]),
			);
			if (!version || version.package_hash !== identity.packageSha256) {
				throw new SnapshotFailure('unavailable');
			}
			const projection = snapshotPluginVersion(version, archives.get(snapshotVersionKey(version)));
			if (
				!projection.toolNames.includes(identity.name) ||
				operation.toolName !== pluginToolName(identity.packageId, identity.name) ||
				operation.toolVersion !==
					identity.packageId + '@' + identity.packageVersion + '#' + identity.packageSha256
			) {
				throw new SnapshotFailure('unavailable');
			}
		}
		// Migrated native model calls retain their original name and immutable hash as historical evidence.
		if (
			operation.identity.kind === 'host' &&
			!relations.has(operation.id) &&
			(operation.identity.operation === 'acp.permission' ||
				operation.toolName === 'remote_file_read_text_page' ||
				operation.toolName === 'remote_directory_list_page' ||
				historicalToolHostOperation(operation.toolName) !== operation.identity.operation)
		) {
			throw new SnapshotFailure('unavailable');
		}
		if (operation.identity.kind === 'host' && operation.identity.operation !== 'acp.permission') {
			const policy = hostOperationDefinition(operation.identity.operation);
			const run = (rows.get('agent_legacy_run_children') ?? []).find((row) => row.run_id === operation.runId);
			if (policy?.childAccess === 'root-only' && run) {
				throw new SnapshotFailure('unavailable');
			}
		}
	}

	// Each child has one parent; complete all paths once rather than rescanning every ancestry.
	const state = new Map<string, 'visiting' | 'complete'>();
	for (const start of relations.keys()) {
		const path: string[] = [];
		let current: string | undefined = start;
		while (current !== undefined && state.get(current) !== 'complete') {
			if (state.get(current) === 'visiting') {
				throw new SnapshotFailure('unavailable');
			}
			state.set(current, 'visiting');
			path.push(current);
			current = relations.get(current)?.parentId;
		}
		for (const id of path) {
			state.set(id, 'complete');
		}
	}
}
