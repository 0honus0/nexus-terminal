import { AgentFailure } from '../agent-failure.js';
import type { PluginCompositionCandidate } from './model/plugin-composition-types.js';
import type { PluginManifest } from './model/plugin-types.js';
import type { PluginPackageReference } from './model/plugin-composition-types.js';
import { matchesAppExecutionDependency } from './plugin-app-execution-rules.js';
import { AGENT_PLUGIN_SDK_VERSION } from '@nexus-terminal/shared/agent/plugins/values';
import { assertPluginCodeDependencies } from './plugin-dependency-rules.js';

/** A selected standalone Surface is not an execution dependency of its App. */
export function pluginExecutionDependencies(
	selected: readonly PluginCompositionCandidate[],
	appPackageId: string,
	selectedRootIds: readonly string[],
	uiPackageId: string | null,
): PluginCompositionCandidate[] {
	return selected.filter((candidate) => {
		const id = candidate.manifest.id;
		if (id === appPackageId) {
			return false;
		}
		return (
			id !== uiPackageId ||
			candidate.manifest.backendEntry !== null ||
			selectedRootIds.includes(id) ||
			selected.some((other) => other.manifest.dependencies.some((dependency) => dependency.packageId === id))
		);
	});
}

/** Resolve actual code dependencies independently of which packages expose capabilities to the App. */
export function resolvePluginPackages(
	appPackageId: string,
	candidates: readonly PluginCompositionCandidate[],
	selectedRootIds: readonly string[],
	uiPackageId: string | null,
): PluginCompositionCandidate[] {
	if (new Set(selectedRootIds).size !== selectedRootIds.length || selectedRootIds.includes(appPackageId)) {
		throw new AgentFailure('invalid_input');
	}
	const available = new Map(candidates.map((candidate) => [candidate.installation.package.packageId, candidate]));
	if (available.size !== candidates.length) {
		throw new AgentFailure('version_conflict');
	}
	const selected = new Map<string, PluginCompositionCandidate>();
	const pending = [appPackageId, ...selectedRootIds, ...(uiPackageId === null ? [] : [uiPackageId])];
	for (let index = 0; index < pending.length; index++) {
		const id = pending[index];
		if (selected.has(id)) {
			continue;
		}
		const candidate = available.get(id);
		if (
			!candidate ||
			candidate.installation.status !== 'installed' ||
			!candidate.publisher ||
			candidate.publisher.revokedAt !== null ||
			candidate.publisher.keyId !== candidate.installation.package.publisherKeyId
		) {
			throw new AgentFailure('forbidden');
		}
		selected.set(id, candidate);
		for (const dependency of candidate.manifest.dependencies) {
			const target = available.get(dependency.packageId);
			if (!target || !matchesAppExecutionDependency(dependency, target.installation.package)) {
				throw new AgentFailure('version_conflict', {
					cause: new Error('Unsatisfied dependency: ' + id + ' -> ' + dependency.packageId),
				});
			}
			pending.push(dependency.packageId);
		}
	}
	const values = [...selected.values()];
	const app = selected.get(appPackageId);
	if (!app?.manifest.contributions.app) {
		throw new AgentFailure('not_found');
	}
	assertPluginExecutionComposition(
		app.manifest,
		values.map((candidate) => ({
			manifest: candidate.manifest,
			package: candidate.installation.package,
		})),
	);
	if (uiPackageId !== null) {
		const ui = selected.get(uiPackageId);
		if (!ui || !isCompatiblePluginUi(app.manifest, ui.manifest)) {
			throw new AgentFailure('version_conflict');
		}
	}
	return values;
}

export function isCompatiblePluginUi(app: PluginManifest, selected: PluginManifest): boolean {
	const required = app.contributions.app;
	const offered = selected.contributions.ui;
	return (
		required !== null &&
		required.uiContract !== null &&
		offered !== null &&
		required.uiContract === offered.contract &&
		required.uiApiVersion === offered.apiVersion &&
		selected.frontendEntry !== null
	);
}

/** Validate the code-delivery graph; actual runtime calls may have different, bidirectional relationships. */
export function assertPluginExecutionComposition(
	app: PluginManifest,
	selected: readonly { manifest: PluginManifest; package: PluginPackageReference }[],
): void {
	if (
		!app.contributions.app ||
		app.backendEntry === null ||
		app.compatibility.backendSdk !== Number(AGENT_PLUGIN_SDK_VERSION)
	) {
		throw new AgentFailure('version_conflict');
	}
	const packages = new Map(selected.map((item) => [item.package.packageId, item]));
	if (packages.size !== selected.length || packages.get(app.id)?.package.version !== app.version) {
		throw new AgentFailure('version_conflict');
	}
	for (const item of selected) {
		if (item.manifest.id !== item.package.packageId || item.manifest.version !== item.package.version) {
			throw new AgentFailure('version_conflict');
		}
		for (const dependency of item.manifest.dependencies) {
			const target = packages.get(dependency.packageId);
			if (!target || !matchesAppExecutionDependency(dependency, target.package)) {
				throw new AgentFailure('version_conflict');
			}
		}
	}
	assertPluginCodeDependencies(
		selected.map((item) => ({
			id: item.package.packageId,
			dependencies: item.manifest.dependencies.map((dependency) => dependency.packageId),
		})),
	);
}
