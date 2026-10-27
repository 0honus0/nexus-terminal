import type {
	AgentIntegrationConfiguration,
	AgentIntegrationView,
	AgentIntegrationDiscovery,
} from '@nexus-terminal/shared/agent/integrations/model';
import type { AgentIntegrationCreateRequest } from '@nexus-terminal/shared/agent/integrations/http';
import { AGENT_MCP_PROTOCOL_VERSION } from '@nexus-terminal/shared/agent/integrations/values';
import { InvalidAgentPayload } from '@nexus-terminal/shared/agent/http-codec';
import type {
	IntegrationConfiguration,
	IntegrationDraft,
	IntegrationDiscovery,
	ManagedIntegration,
} from './integration-types';

function fromConfiguration(value: AgentIntegrationConfiguration): IntegrationConfiguration {
	if (value.kind === 'mcp') {
		return {
			kind: 'mcp',
			name: value.displayName,
			endpoint: value.endpoint,
			privateHosts: value.privateHostExceptions.map((host) => host),
		};
	}
	return {
		kind: 'acp',
		name: value.displayName,
		connectionId: value.connectionId,
		argv: value.argv.map((arg) => arg),
		cwd: value.cwd,
	};
}

export function fromIntegration(value: AgentIntegrationView): ManagedIntegration {
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

export function toIntegrationDraft(value: ManagedIntegration): IntegrationDraft {
	const config = value.configuration;
	return {
		kind: config.kind,
		name: config.name,
		endpoint: config.kind === 'mcp' ? config.endpoint : '',
		privateHostsText: config.kind === 'mcp' ? config.privateHosts.join('\n') : '',
		connectionId: config.kind === 'acp' ? config.connectionId : 0,
		argvJson: config.kind === 'acp' ? JSON.stringify(config.argv) : '["agent","--acp"]',
		cwd: config.kind === 'acp' ? config.cwd : '/tmp',
		enabled: value.enabled,
		credentialAction: config.kind === 'mcp' ? 'keep' : 'clear',
		credential: '',
	};
}

export function newIntegrationDraft(): IntegrationDraft {
	return {
		kind: 'mcp',
		name: '',
		endpoint: '',
		privateHostsText: '',
		connectionId: 0,
		argvJson: '["agent","--acp"]',
		cwd: '/tmp',
		enabled: false,
		credentialAction: 'clear',
		credential: '',
	};
}

export function toIntegrationInput(value: IntegrationDraft): AgentIntegrationCreateRequest {
	let configuration: AgentIntegrationConfiguration;
	if (value.kind === 'mcp') {
		configuration = {
			kind: 'mcp',
			displayName: value.name,
			endpoint: value.endpoint,
			privateHostExceptions: value.privateHostsText
				.split('\n')
				.map((host) => host.trim())
				.filter(Boolean),
			protocolVersion: AGENT_MCP_PROTOCOL_VERSION,
		};
	} else {
		const argv: unknown = JSON.parse(value.argvJson);
		if (!Array.isArray(argv)) {
			throw new InvalidAgentPayload();
		}
		const args = argv.map((arg: unknown) => {
			if (typeof arg !== 'string') {
				throw new InvalidAgentPayload();
			}
			return arg;
		});
		configuration = {
			kind: 'acp',
			displayName: value.name,
			connectionId: value.connectionId,
			argv: args,
			cwd: value.cwd,
			protocolVersion: '1',
		};
	}
	return {
		configuration,
		enabled: value.enabled,
		credential:
			value.kind === 'acp'
				? { action: 'clear' }
				: value.credentialAction === 'replace'
					? { action: 'replace', value: value.credential }
					: { action: value.credentialAction },
	};
}

export function fromIntegrationDiscovery(value: AgentIntegrationDiscovery): IntegrationDiscovery {
	return {
		integration: fromIntegration(value.integration),
		serverName: value.serverName,
		serverVersion: value.serverVersion,
		protocolVersion: value.protocolVersion,
		tools: value.tools.map((tool) => ({
			name: tool.name,
			description: tool.description,
			inputSchemaJson: tool.inputSchemaJson,
		})),
		resources: value.resources.map((resource) => ({ uri: resource.uri, name: resource.name })),
		prompts: value.prompts.map((prompt) => ({ name: prompt.name, description: prompt.description })),
	};
}
