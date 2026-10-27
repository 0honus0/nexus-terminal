import {
	readAgentIntegrationCreate,
	readAgentIntegrationCreateHeaders,
	readAgentIntegrationDeleteResponse,
	readAgentIntegrationDiscovery,
	readAgentIntegrationList,
	readAgentIntegrationPath,
	readAgentIntegrationUpdate,
	readAgentIntegrationVersion,
	readAgentIntegrationView,
} from '@nexus-terminal/shared/agent/integrations/http-codec';
import { readAgentId } from '@nexus-terminal/shared/agent/http-codec';
import {
	AGENT_INTEGRATION_MAX_BODY_BYTES,
	AGENT_INTEGRATION_MAX_RESPONSE_BYTES,
} from '@nexus-terminal/shared/agent/integrations/values';
import type {
	AgentIntegrationCreateRequest,
	AgentIntegrationUpdateRequest,
} from '@nexus-terminal/shared/agent/integrations/http';
import type { AgentIntegrationView } from '@nexus-terminal/shared/agent/integrations/model';
import { structurallyEqual } from '@/foundation/data';
import { fromIntegration, fromIntegrationDiscovery, toIntegrationInput } from '../model/integration-mapper';
import type { IntegrationDraft, IntegrationDiscovery, ManagedIntegration } from '../model/integration-types';
import { AgentManagementFailure } from '../model/management-failure';
import { requestAgentManagement } from './management-request';

function integrationPath(appId: string, id?: string): string {
	try {
		if (id === undefined) {
			return '/' + encodeURIComponent(readAgentId(appId)) + '/integrations';
		}
		const path = readAgentIntegrationPath({ appId, integrationId: id });
		return '/' + encodeURIComponent(path.appId) + '/integrations/' + encodeURIComponent(path.integrationId);
	} catch (cause) {
		throw new AgentManagementFailure('invalid_input', 'not_dispatched', { cause });
	}
}

const budgets = {
	apiBase: '/api/v1/apps',
	maxRequestBytes: AGENT_INTEGRATION_MAX_BODY_BYTES,
	maxResponseBytes: AGENT_INTEGRATION_MAX_RESPONSE_BYTES,
} as const;

function matchesInput(actual: AgentIntegrationView, expected: AgentIntegrationCreateRequest): boolean {
	return (
		structurallyEqual(actual.configuration, expected.configuration) &&
		actual.enabled === expected.enabled &&
		(expected.credential.action === 'keep' || actual.hasCredential === (expected.credential.action === 'replace'))
	);
}

export async function listManagedIntegrations(appId: string, signal?: AbortSignal): Promise<ManagedIntegration[]> {
	const result = await requestAgentManagement({
		...budgets,
		method: 'GET',
		path: integrationPath(appId),
		signal,

		decode(value) {
			const result = readAgentIntegrationList(value);
			if (result.items.some((item) => item.appId !== appId)) {
				throw new Error('Integration list belongs to another App');
			}
			return result.items;
		},
	});
	return result.map(fromIntegration);
}

export async function getManagedIntegration(
	appId: string,
	id: string,
	signal?: AbortSignal,
): Promise<ManagedIntegration> {
	const result = await requestAgentManagement({
		...budgets,
		method: 'GET',
		path: integrationPath(appId, id),
		signal,

		decode(value) {
			const result = readAgentIntegrationView(value);
			if (result.appId !== appId || result.id !== id) {
				throw new Error('Integration response belongs to another resource');
			}
			return result;
		},
	});
	return fromIntegration(result);
}

export async function createManagedIntegration(
	appId: string,
	draft: IntegrationDraft,
	key: string,
	signal?: AbortSignal,
): Promise<ManagedIntegration> {
	let expected: AgentIntegrationCreateRequest | null = null;
	const result = await requestAgentManagement({
		...budgets,
		method: 'POST',
		path: integrationPath(appId),
		expectedStatus: 201,
		signal,

		headers: () => ({
			'Idempotency-Key': readAgentIntegrationCreateHeaders({ idempotencyKey: key }).idempotencyKey,
		}),

		input() {
			expected = readAgentIntegrationCreate(toIntegrationInput(draft));
			if (expected.credential.action === 'keep') {
				throw new Error('Creation cannot retain a missing credential');
			}
			return expected;
		},

		decode(value) {
			const result = readAgentIntegrationView(value);
			if (!expected || result.appId !== appId || result.version !== 1 || !matchesInput(result, expected)) {
				throw new Error('Integration creation confirmation mismatch');
			}
			return result;
		},
	});
	return fromIntegration(result);
}

export async function updateManagedIntegration(
	appId: string,
	original: ManagedIntegration,
	draft: IntegrationDraft,
	signal?: AbortSignal,
): Promise<ManagedIntegration> {
	let expected: AgentIntegrationUpdateRequest | null = null;
	const result = await requestAgentManagement({
		...budgets,
		method: 'PATCH',
		path: integrationPath(appId, original.id),
		signal,

		input() {
			const input = toIntegrationInput(draft);
			expected = readAgentIntegrationUpdate({
				expectedVersion: original.version,
				configuration: input.configuration,
				enabled: input.enabled,
				credential: input.credential,
			});
			return expected;
		},

		decode(value) {
			const result = readAgentIntegrationView(value);
			if (
				!expected ||
				result.appId !== appId ||
				result.id !== original.id ||
				result.version !== original.version + 1 ||
				!matchesInput(result, expected)
			) {
				throw new Error('Integration update confirmation mismatch');
			}
			return result;
		},
	});
	return fromIntegration(result);
}

export async function deleteManagedIntegration(
	appId: string,
	original: ManagedIntegration,
	signal?: AbortSignal,
): Promise<void> {
	await requestAgentManagement({
		...budgets,
		method: 'DELETE',
		path: integrationPath(appId, original.id),
		signal,

		input: () => ({ expectedVersion: readAgentIntegrationVersion({ expectedVersion: original.version }) }),

		decode: readAgentIntegrationDeleteResponse,
	});
}

export async function discoverManagedIntegration(
	appId: string,
	original: ManagedIntegration,
	signal?: AbortSignal,
): Promise<IntegrationDiscovery> {
	const result = await requestAgentManagement({
		...budgets,
		method: 'POST',
		path: integrationPath(appId, original.id) + '/refresh',
		signal,

		input: () => ({ expectedVersion: readAgentIntegrationVersion({ expectedVersion: original.version }) }),

		decode(value) {
			const result = readAgentIntegrationDiscovery(value);
			if (
				result.integration.appId !== appId ||
				result.integration.id !== original.id ||
				result.integration.version !== original.version + 1 ||
				result.integration.schemaHash === null
			) {
				throw new Error('Integration discovery confirmation mismatch');
			}
			return result;
		},
	});
	return fromIntegrationDiscovery(result);
}
