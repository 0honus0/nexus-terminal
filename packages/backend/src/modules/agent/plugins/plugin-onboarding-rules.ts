import { AgentFailure } from '../agent-failure.js';
import type { PluginManifest } from './model/plugin-types.js';
import type { PluginAppBinding } from './model/plugin-composition-types.js';
import type { PluginEnableCandidate, PluginEnableComposition } from './model/plugin-onboarding-types.js';
import { assertPluginExecutionComposition, isCompatiblePluginUi } from './plugin-app-composition-rules.js';

/** Selection follows signed contributions and contracts; package IDs are not host policy. */
export function requiredPluginSelection(
	app: PluginManifest,
	required: readonly PluginManifest[],
	available: readonly PluginManifest[],
	binding: PluginAppBinding | null,
): { selectedRootIds: string[]; uiPackageId: string | null } {
	const currentUi = available.find((item) => item.id === binding?.ui?.packageId);
	let uiPackageId: string | null = null;
	if (currentUi && isCompatiblePluginUi(app, currentUi)) {
		uiPackageId = currentUi.id;
	} else if (app.contributions.app?.uiContract !== null) {
		const matches = required.filter((item) => isCompatiblePluginUi(app, item));
		if (matches.length !== 1) {
			throw new AgentFailure('version_conflict');
		}
		uiPackageId = matches[0]?.id ?? null;
	}
	const roots = required.filter(
		(item) =>
			item.id !== app.id &&
			item.contributions.app === null &&
			(item.contributions.tools || item.contributions.services || item.contributions.skills.length > 0),
	);
	return {
		selectedRootIds: [...new Set([...(binding?.selectedRootIds ?? []), ...roots.map((item) => item.id)])],
		uiPackageId,
	};
}

/** Resolve the full consented composition before installing any package. */
export function requiredPluginCompositions(
	required: readonly PluginManifest[],
	candidates: readonly PluginEnableCandidate[],
	bindings: readonly PluginAppBinding[],
): PluginEnableComposition[] {
	return required
		.filter((manifest) => manifest.contributions.app !== null)
		.flatMap((app) => {
			const existing = bindings.filter((binding) => binding.app.packageId === app.id);
			return (existing.length ? existing : [null]).map((binding) => {
				const selection = requiredPluginSelection(
					app,
					required,
					candidates.map((candidate) => candidate.manifest),
					binding,
				);
				const available = new Map(candidates.map((candidate) => [candidate.manifest.id, candidate]));
				const selected = new Map<string, PluginEnableCandidate>();
				const pending = [
					app.id,
					...selection.selectedRootIds,
					...(selection.uiPackageId === null ? [] : [selection.uiPackageId]),
				];
				for (const id of pending) {
					if (selected.has(id)) {
						continue;
					}
					const candidate = available.get(id);
					if (!candidate) {
						throw new AgentFailure('version_conflict');
					}
					selected.set(id, candidate);
					pending.push(...candidate.manifest.dependencies.map((dependency) => dependency.packageId));
				}
				assertPluginExecutionComposition(app, [...selected.values()]);
				return {
					packageId: app.id,
					appId: binding?.appId ?? null,
					expectedBinding: binding
						? { executionRevision: binding.executionRevision, uiRevision: binding.uiRevision }
						: null,
					selectedRootIds: selection.selectedRootIds,
					uiPackageId: selection.uiPackageId,
					expectedPackages: [...selected.values()].map((candidate) => candidate.package),
				};
			});
		});
}
