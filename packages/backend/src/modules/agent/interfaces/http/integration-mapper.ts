import type {
	AgentIntegrationConfiguration,
	AgentIntegrationView,
	AgentIntegrationDiscovery,
} from '@nexus-terminal/shared/agent/integrations/model';
import type { AgentIntegrationCreateRequest } from '@nexus-terminal/shared/agent/integrations/http';
import type {
	IntegrationConfiguration,
	IntegrationInput,
	IntegrationRecord,
	IntegrationDiscovery,
} from '../../integrations/model/integration-types.js';

function toConfiguration(value: AgentIntegrationConfiguration): IntegrationConfiguration {
	if (value.kind === 'mcp') {
		return {
			kind: 'mcp',
			displayName: value.displayName,
			endpoint: value.endpoint,
			privateHostExceptions: value.privateHostExceptions.map((host) => host),
			protocolVersion: value.protocolVersion,
		};
	}
	return {
		kind: 'acp',
		displayName: value.displayName,
		connectionId: value.connectionId,
		argv: value.argv.map((arg) => arg),
		cwd: value.cwd,
		protocolVersion: value.protocolVersion,
	};
}

function fromConfiguration(value: IntegrationConfiguration): AgentIntegrationConfiguration {
	if (value.kind === 'mcp') {
		return {
			kind: 'mcp',
			displayName: value.displayName,
			endpoint: value.endpoint,
			privateHostExceptions: value.privateHostExceptions.map((host) => host),
			protocolVersion: value.protocolVersion,
		};
	}
	return {
		kind: 'acp',
		displayName: value.displayName,
		connectionId: value.connectionId,
		argv: value.argv.map((arg) => arg),
		cwd: value.cwd,
		protocolVersion: value.protocolVersion,
	};
}

export function toIntegrationInput(value: AgentIntegrationCreateRequest): IntegrationInput {
	return {
		configuration: toConfiguration(value.configuration),
		enabled: value.enabled,
		credential:
			value.credential.action === 'replace'
				? { action: 'replace', value: value.credential.value }
				: { action: value.credential.action },
	};
}

export function toIntegrationView(value: IntegrationRecord): AgentIntegrationView {
	return {
		id: value.id,
		appId: value.appId,
		configuration: fromConfiguration(value.configuration),
		enabled: value.enabled,
		hasCredential: value.hasCredential,
		credentialRevision: value.credentialRevision,
		schemaHash: value.schemaHash,
		version: value.version,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

export function toIntegrationDiscovery(value: {
	integration: IntegrationRecord;
	catalog: IntegrationDiscovery;
}): AgentIntegrationDiscovery {
	return {
		integration: toIntegrationView(value.integration),
		serverName: value.catalog.serverName,
		serverVersion: value.catalog.serverVersion,
		protocolVersion: value.catalog.protocolVersion,
		tools: value.catalog.tools.map((tool) => ({
			name: tool.name,
			description: tool.description,
			inputSchemaJson: tool.inputSchemaJson,
		})),
		resources: value.catalog.resources.map((resource) => ({ uri: resource.uri, name: resource.name })),
		prompts: value.catalog.prompts.map((prompt) => ({ name: prompt.name, description: prompt.description })),
	};
}
