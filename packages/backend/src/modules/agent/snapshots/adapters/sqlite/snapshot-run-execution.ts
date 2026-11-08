import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import { SnapshotFailure } from '../../../../../platform/storage/sqlite/snapshot-types.js';
import { readRunAppExecution } from '../../../runs/adapters/sqlite/run-app-execution-row.js';
import { sameRunAppExecution } from '../../../runs/adapters/sqlite/run-app-execution-sql.js';
import { pluginManifest } from '../../../plugins/adapters/package/plugin-manifest.js';
import { matchesAppExecutionDependency } from '../../../plugins/plugin-app-execution-rules.js';
import { AGENT_PLUGIN_SDK_VERSION } from '@nexus-terminal/shared/agent/plugins/values';

/** Immutable code provenance survives updates. Backup validation never activates an old implementation. */
export function validateSnapshotRunExecution(rows: ReadonlyMap<string, readonly SqlRow[]>): void {
	const runs = new Map((rows.get('agent_runs') ?? []).map((run) => [run.id, run]));
	const inputs = new Map((rows.get('agent_run_inputs') ?? []).map((input) => [input.run_id, input]));
	const versions = rows.get('agent_plugin_versions') ?? [];
	for (const [id, run] of runs) {
		const input = inputs.get(id);
		if (!input || typeof input.input_json !== 'string') {
			throw new SnapshotFailure('unavailable');
		}
		JSON.parse(input.input_json);
		const execution = readRunAppExecution(input.app_execution_json);
		const manifests = new Map(
			execution.codeDependencies.concat(execution.package).map((reference) => {
				const version = versions.find(
					(version) =>
						version.user_id === run.user_id &&
						version.definition_id === reference.packageId &&
						version.version === reference.version &&
						version.package_hash === reference.packageHash &&
						version.publisher_key_id === reference.publisherKeyId,
				);
				if (!version || typeof version.manifest_json !== 'string') {
					throw new SnapshotFailure('unavailable');
				}
				const manifest = pluginManifest(JSON.parse(version.manifest_json));
				if (manifest.id !== reference.packageId || manifest.version !== reference.version) {
					throw new SnapshotFailure('unavailable');
				}
				return [reference.packageId, manifest];
			}),
		);
		const main = manifests.get(execution.package.packageId);
		if (
			!main?.contributions.app ||
			main.contributions.app.entry !== execution.handler ||
			main.backendEntry === null ||
			main.compatibility.backendSdk !== Number(AGENT_PLUGIN_SDK_VERSION)
		) {
			throw new SnapshotFailure('unavailable');
		}
		const pending = [main];
		const visited = new Set<string>();
		while (pending.length) {
			const manifest = pending.pop();
			if (!manifest || visited.has(manifest.id)) {
				continue;
			}
			visited.add(manifest.id);
			for (const dependency of manifest.dependencies) {
				const reference = execution.codeDependencies
					.concat(execution.package)
					.find((item) => item.packageId === dependency.packageId);
				const selected = manifests.get(dependency.packageId);
				if (!reference || !selected || !matchesAppExecutionDependency(dependency, reference)) {
					throw new SnapshotFailure('unavailable');
				}
				pending.push(selected);
			}
		}
		if (visited.size !== manifests.size) {
			throw new SnapshotFailure('unavailable');
		}
	}
	for (const child of rows.get('agent_run_children') ?? []) {
		const childInput = inputs.get(child.run_id),
			parentInput = inputs.get(child.parent_id);
		const childRun = runs.get(child.run_id),
			parentRun = runs.get(child.parent_id);
		if (
			!childInput ||
			!parentInput ||
			!childRun ||
			!parentRun ||
			childRun.user_id !== parentRun.user_id ||
			childRun.app_id !== parentRun.app_id ||
			!sameRunAppExecution(
				readRunAppExecution(childInput.app_execution_json),
				readRunAppExecution(parentInput.app_execution_json),
			)
		) {
			throw new SnapshotFailure('unavailable');
		}
	}
}
