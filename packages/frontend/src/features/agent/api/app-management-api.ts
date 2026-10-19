import {
	readAgentAppDefinitionListResponse,
	readAgentAppListResponse,
	readAgentAppPath,
	readAgentAppResponse,
	readAgentAppStateUpdateRequest,
	readAgentCreateAppRequest,
} from '@nexus-terminal/shared/agent/scope/http-codec';
import { AGENT_APP_MAX_RESPONSE_BYTES } from '@nexus-terminal/shared/agent/scope/values';
import { AGENT_MAX_JSON_BODY_BYTES } from '@nexus-terminal/shared/agent/values';
import {
	readAgentExecutionPolicyReplaceRequest,
	readAgentExecutionPolicyView,
	readAgentGrantReplaceRequest,
	readAgentGrantView,
	readAgentTargetDenylistReplaceRequest,
	readAgentTargetDenylistResponse,
} from '@nexus-terminal/shared/agent/governance/http-codec';
import {
	AGENT_EXECUTION_INTEGER_KEYS,
	AGENT_GOVERNANCE_MAX_BODY_BYTES,
	AGENT_GOVERNANCE_MAX_GRANT_BODY_BYTES,
	AGENT_GOVERNANCE_MAX_RESPONSE_BYTES,
} from '@nexus-terminal/shared/agent/governance/values';
import type { AgentCreateAppRequest } from '@nexus-terminal/shared/agent/scope/http';
import type {
	AgentExecutionPolicyReplaceRequest,
	AgentGrantReplaceRequest,
	AgentTargetDenylistReplaceRequest,
} from '@nexus-terminal/shared/agent/governance/http';
import {
	fromAgentDenylist,
	fromAppDefinition,
	fromAppGrants,
	fromAppPolicy,
	fromManagedApp,
	toAppGrants,
	toAppPolicy,
} from '../model/app-management-mapper';
import type {
	AgentDenylist,
	AgentDenylistDraft,
	AppDefinition,
	AppExecutionPolicy,
	AppGrantInput,
	AppGrants,
	AppPolicyOverrides,
	ManagedApp,
} from '../model/app-management-types';
import { AgentManagementFailure } from '../model/management-failure';
import { requestAgentManagement } from './management-request';

function appPath(appId: string): string {
	try {
		return '/apps/' + encodeURIComponent(readAgentAppPath({ appId }).appId);
	} catch (cause) {
		throw new AgentManagementFailure('invalid_input', 'not_dispatched', { cause });
	}
}

export async function listManagedApps(signal?: AbortSignal): Promise<ManagedApp[]> {
	const result = await requestAgentManagement({
		method: 'GET',
		path: '/apps',
		maxRequestBytes: AGENT_MAX_JSON_BODY_BYTES,
		maxResponseBytes: AGENT_APP_MAX_RESPONSE_BYTES,
		decode: readAgentAppListResponse,
		signal,
	});
	return result.map(fromManagedApp);
}

export async function listAppDefinitions(signal?: AbortSignal): Promise<AppDefinition[]> {
	const result = await requestAgentManagement({
		method: 'GET',
		path: '/app-definitions',
		maxRequestBytes: AGENT_MAX_JSON_BODY_BYTES,
		maxResponseBytes: AGENT_APP_MAX_RESPONSE_BYTES,
		decode: readAgentAppDefinitionListResponse,
		signal,
	});
	return result.map(fromAppDefinition);
}

export async function createManagedApp(name: string, definitionId: string, signal?: AbortSignal): Promise<ManagedApp> {
	let expected: AgentCreateAppRequest | null = null;
	const result = await requestAgentManagement({
		method: 'POST',
		path: '/apps',
		expectedStatus: 201,

		input() {
			expected = readAgentCreateAppRequest({ name, definitionId });
			return expected;
		},

		maxRequestBytes: AGENT_MAX_JSON_BODY_BYTES,
		maxResponseBytes: AGENT_MAX_JSON_BODY_BYTES,

		decode(value) {
			const app = readAgentAppResponse(value);
			if (
				!expected ||
				app.name !== expected.name.trim() ||
				app.definitionId !== expected.definitionId ||
				app.version !== 1
			) {
				throw new Error('Unexpected App creation confirmation');
			}
			return app;
		},

		signal,
	});
	return fromManagedApp(result);
}

export async function setManagedAppEnabled(
	app: ManagedApp,
	enabled: boolean,
	signal?: AbortSignal,
): Promise<ManagedApp> {
	const result = await requestAgentManagement({
		method: 'PATCH',
		path: appPath(app.id),

		input: () => readAgentAppStateUpdateRequest({ enabled, expectedVersion: app.version }),

		maxRequestBytes: AGENT_MAX_JSON_BODY_BYTES,
		maxResponseBytes: AGENT_MAX_JSON_BODY_BYTES,

		decode(value) {
			const result = readAgentAppResponse(value);
			if (result.id !== app.id || result.version !== app.version + 1 || result.enabled !== enabled) {
				throw new Error('Unexpected App state confirmation');
			}
			return result;
		},

		signal,
	});
	return fromManagedApp(result);
}

export async function getAppGrants(appId: string, signal?: AbortSignal): Promise<AppGrants> {
	const result = await requestAgentManagement({
		method: 'GET',
		path: appPath(appId) + '/grants',
		maxRequestBytes: AGENT_GOVERNANCE_MAX_BODY_BYTES,
		maxResponseBytes: AGENT_GOVERNANCE_MAX_RESPONSE_BYTES,

		decode(value) {
			const result = readAgentGrantView(value);
			if (result.appId !== appId) {
				throw new Error('Grant response belongs to another App');
			}
			return result;
		},

		signal,
	});
	return fromAppGrants(result);
}

export async function saveAppGrants(
	appId: string,
	revision: number,
	grants: AppGrantInput[],
	signal?: AbortSignal,
): Promise<AppGrants> {
	let expected: AgentGrantReplaceRequest | null = null;
	const result = await requestAgentManagement({
		method: 'PUT',
		path: appPath(appId) + '/grants',

		input() {
			expected = readAgentGrantReplaceRequest(toAppGrants(grants, revision));
			return expected;
		},

		maxRequestBytes: AGENT_GOVERNANCE_MAX_GRANT_BODY_BYTES,
		maxResponseBytes: AGENT_GOVERNANCE_MAX_RESPONSE_BYTES,

		decode(value) {
			const result = readAgentGrantView(value);
			if (
				!expected ||
				result.appId !== appId ||
				result.policyRevision !== revision + 1 ||
				result.grants.length !== expected.grants.length ||
				expected.grants.some((grant) => {
					const actual = result.grants.find((item) => item.capability === grant.capability);
					return !actual || JSON.stringify(actual.scope) !== JSON.stringify(grant.scope);
				})
			) {
				throw new Error('Grant confirmation does not match submitted scope');
			}
			return result;
		},

		signal,
	});
	return fromAppGrants(result);
}

export async function getAppExecutionPolicy(appId: string, signal?: AbortSignal): Promise<AppExecutionPolicy> {
	const result = await requestAgentManagement({
		method: 'GET',
		path: appPath(appId) + '/execution-policy',
		maxRequestBytes: AGENT_GOVERNANCE_MAX_BODY_BYTES,
		maxResponseBytes: AGENT_GOVERNANCE_MAX_RESPONSE_BYTES,
		decode: readAgentExecutionPolicyView,
		signal,
	});
	return fromAppPolicy(result);
}

export async function saveAppExecutionPolicy(
	appId: string,
	version: number,
	overrides: AppPolicyOverrides,
	signal?: AbortSignal,
): Promise<AppExecutionPolicy> {
	let expected: AgentExecutionPolicyReplaceRequest | null = null;
	const result = await requestAgentManagement({
		method: 'PUT',
		path: appPath(appId) + '/execution-policy',

		input() {
			expected = readAgentExecutionPolicyReplaceRequest({
				expectedVersion: version,
				overrides: toAppPolicy(overrides),
			});
			return expected;
		},

		maxRequestBytes: AGENT_GOVERNANCE_MAX_BODY_BYTES,
		maxResponseBytes: AGENT_GOVERNANCE_MAX_RESPONSE_BYTES,

		decode(value) {
			const result = readAgentExecutionPolicyView(value);
			if (
				!expected ||
				result.version !== version + 1 ||
				AGENT_EXECUTION_INTEGER_KEYS.some((key) => result.overrides[key] !== expected?.overrides[key]) ||
				result.overrides.contextProfile !== expected.overrides.contextProfile ||
				result.overrides.contextCompactionMode !== expected.overrides.contextCompactionMode
			) {
				throw new Error('Execution policy confirmation mismatch');
			}
			return result;
		},

		signal,
	});
	return fromAppPolicy(result);
}

export async function getAgentDenylist(signal?: AbortSignal): Promise<AgentDenylist> {
	const result = await requestAgentManagement({
		method: 'GET',
		path: '/target-denylist',
		maxRequestBytes: AGENT_GOVERNANCE_MAX_BODY_BYTES,
		maxResponseBytes: AGENT_GOVERNANCE_MAX_RESPONSE_BYTES,
		decode: readAgentTargetDenylistResponse,
		signal,
	});
	return fromAgentDenylist(result);
}

export async function saveAgentDenylist(
	revision: number,
	draft: AgentDenylistDraft,
	signal?: AbortSignal,
): Promise<AgentDenylist> {
	let expected: AgentTargetDenylistReplaceRequest | null = null;
	const result = await requestAgentManagement({
		method: 'PUT',
		path: '/target-denylist',

		input() {
			expected = readAgentTargetDenylistReplaceRequest({
				expectedRevision: revision,
				connectionIds: draft.connectionIds.map((id) => id),
				reason: draft.reason,
			});
			return expected;
		},

		maxRequestBytes: AGENT_GOVERNANCE_MAX_BODY_BYTES,
		maxResponseBytes: AGENT_GOVERNANCE_MAX_RESPONSE_BYTES,

		decode(value) {
			const result = readAgentTargetDenylistResponse(value);
			if (
				!expected ||
				result.revision !== revision + 1 ||
				result.entries.length !== expected.connectionIds.length ||
				result.entries.some(
					(entry) =>
						!expected?.connectionIds.includes(entry.connectionId) || entry.reason !== expected.reason,
				)
			) {
				throw new Error('Denylist confirmation mismatch');
			}
			return result;
		},

		signal,
	});
	return fromAgentDenylist(result);
}
