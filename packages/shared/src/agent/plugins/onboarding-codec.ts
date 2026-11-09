import { agentRecord, agentInteger, readAgentId, isAgentRecord, InvalidAgentPayload } from '../http-codec.js';
import {
	readAgentPluginManifest,
	readAgentPluginPackageInstallation,
	readAgentPluginPackageReference,
	readAgentPluginAppBinding,
} from './http-codec.js';
import { readAgentPluginInstallPlan, readAgentPluginInstallPlanRequest } from './install-plan-codec.js';
import { AGENT_PLUGIN_MAX_BODY_BYTES, AGENT_PLUGIN_MAX_RESPONSE_BYTES } from './values.js';
import type { AgentPluginEnablePlan, AgentPluginEnableRequest, AgentPluginEnableResponse } from './onboarding.js';

export function readAgentPluginEnablePlan(input: unknown): AgentPluginEnablePlan {
	const row = agentRecord(input, ['packages', 'bindings', 'ready'], AGENT_PLUGIN_MAX_RESPONSE_BYTES);
	if (!Array.isArray(row.packages) || !Array.isArray(row.bindings) || typeof row.ready !== 'boolean') {
		throw new InvalidAgentPayload();
	}
	const packages = row.packages.map((input: unknown) => {
		const item = agentRecord(
			input,
			isAgentRecord(input) && input.kind === 'installed'
				? ['kind', 'installation', 'manifest']
				: ['kind', 'plan'],
			AGENT_PLUGIN_MAX_RESPONSE_BYTES,
		);
		if (item.kind === 'plan') {
			return { kind: 'plan' as const, plan: readAgentPluginInstallPlan(item.plan) };
		}
		if (item.kind !== 'installed') {
			throw new InvalidAgentPayload();
		}
		const installation = readAgentPluginPackageInstallation(item.installation);
		const manifest = readAgentPluginManifest(item.manifest);
		if (
			installation.status !== 'installed' ||
			manifest.id !== installation.packageId ||
			manifest.version !== installation.version
		) {
			throw new InvalidAgentPayload();
		}
		return { kind: 'installed' as const, installation, manifest };
	});
	const manifests = packages.map((item) => (item.kind === 'plan' ? item.plan.target.stage.manifest : item.manifest));
	if (
		!manifests.some((item) => item.contributions.app !== null) ||
		manifests.some((item) => item.requiredOnEnable !== true) ||
		new Set(manifests.map((item) => item.id)).size !== manifests.length ||
		(row.ready && packages.some((item) => item.kind !== 'installed'))
	) {
		throw new InvalidAgentPayload();
	}
	const bindings = row.bindings.map(readAgentPluginAppBinding);
	const apps = manifests.filter((item) => item.contributions.app !== null);
	const invalidBinding = bindings.some((binding) => !apps.some((app) => app.id === binding.app.packageId));
	const incompleteReadyBinding =
		row.ready &&
		(apps.some((app) => !bindings.some((binding) => binding.app.packageId === app.id)) ||
			bindings.some((binding) => {
				const selected = packages.find(
					(item) => item.kind === 'installed' && item.installation.packageId === binding.app.packageId,
				);
				return (
					selected?.kind !== 'installed' ||
					selected.installation.version !== binding.app.version ||
					selected.installation.packageHash !== binding.app.packageHash ||
					selected.installation.publisherKeyId !== binding.app.publisherKeyId ||
					(selected.manifest.contributions.app?.uiContract !== null && binding.ui === null)
				);
			}));
	if (
		new Set(bindings.map((item) => item.appId)).size !== bindings.length ||
		invalidBinding ||
		incompleteReadyBinding
	) {
		throw new InvalidAgentPayload();
	}
	return { packages, bindings, ready: row.ready };
}

export function readAgentPluginEnableRequest(input: unknown): AgentPluginEnableRequest {
	const row = agentRecord(input, ['packages', 'bindings'], AGENT_PLUGIN_MAX_BODY_BYTES);
	if (!Array.isArray(row.packages) || !Array.isArray(row.bindings)) {
		throw new InvalidAgentPayload();
	}
	const packages = row.packages.map((input: unknown) => {
		const item = agentRecord(
			input,
			isAgentRecord(input) && input.kind === 'installed'
				? ['kind', 'expectedRevision', 'package']
				: ['kind', 'plan'],
			AGENT_PLUGIN_MAX_BODY_BYTES,
		);
		if (item.kind === 'plan') {
			const plan = readAgentPluginInstallPlanRequest(item.plan);
			if (plan.initialization !== 'declared_grants') {
				throw new InvalidAgentPayload();
			}
			return { kind: 'plan' as const, plan };
		}
		if (item.kind !== 'installed') {
			throw new InvalidAgentPayload();
		}
		return {
			kind: 'installed' as const,
			expectedRevision: agentInteger(item.expectedRevision, 1),
			package: readAgentPluginPackageReference(item.package),
		};
	});
	const ids = packages.map((item) =>
		item.kind === 'installed' ? item.package.packageId : item.plan.target.package.packageId,
	);
	const bindings = row.bindings.map((input) => {
		const item = agentRecord(input, ['appId', 'executionRevision', 'uiRevision']);
		return {
			appId: readAgentId(item.appId),
			executionRevision: agentInteger(item.executionRevision, 1),
			uiRevision: agentInteger(item.uiRevision, 1),
		};
	});
	if (new Set(ids).size !== ids.length || new Set(bindings.map((item) => item.appId)).size !== bindings.length) {
		throw new InvalidAgentPayload();
	}
	return { packages, bindings };
}

export function readAgentPluginEnableResponse(input: unknown): AgentPluginEnableResponse {
	const row = agentRecord(input, ['bindings'], AGENT_PLUGIN_MAX_RESPONSE_BYTES);
	if (!Array.isArray(row.bindings) || row.bindings.length === 0) {
		throw new InvalidAgentPayload();
	}
	const bindings = row.bindings.map(readAgentPluginAppBinding);
	if (new Set(bindings.map((item) => item.appId)).size !== bindings.length) {
		throw new InvalidAgentPayload();
	}
	return { bindings };
}
