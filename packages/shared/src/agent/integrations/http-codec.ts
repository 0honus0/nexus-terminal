import { agentRecord, agentText, agentInteger, readAgentId, InvalidAgentPayload } from '../http-codec.js';
import {
	AGENT_INTEGRATION_MAX_BODY_BYTES,
	AGENT_INTEGRATION_MAX_ITEMS,
	AGENT_INTEGRATION_MAX_RESPONSE_BYTES,
	AGENT_MCP_PROTOCOL_VERSION,
	AGENT_INTEGRATION_NAME_MAX_BYTES,
	AGENT_MCP_ENDPOINT_MAX_BYTES,
	AGENT_MCP_HOST_MAX_ITEMS,
	AGENT_MCP_HOST_MAX_BYTES,
	AGENT_ACP_ARGV_MAX_ITEMS,
	AGENT_ACP_ARGV_MAX_BYTES,
	AGENT_ACP_CWD_MAX_BYTES,
} from './values.js';
import type { AgentIntegrationConfiguration, AgentIntegrationView, AgentIntegrationDiscovery } from './model.js';
import type {
	AgentIntegrationCreateRequest,
	AgentIntegrationUpdateRequest,
	AgentIntegrationCredential,
	AgentIntegrationCreateHeaders,
	AgentIntegrationDeleteResponse,
} from './http.js';

function list(input: unknown, max: number, bytes: number): string[] {
	if (!Array.isArray(input) || input.length > max) {
		throw new InvalidAgentPayload();
	}
	return input.map((item) => agentText(item, bytes));
}

function authority(value: string): boolean {
	const port = value.match(/:([0-9]+)$/u)?.[1];
	if (!port || Number(port) < 1 || Number(port) > 65535) {
		return false;
	}
	try {
		const url = new URL('https://' + value);
		return (
			!url.username &&
			!url.password &&
			url.pathname === '/' &&
			!url.search &&
			!url.hash &&
			value === url.hostname.toLowerCase() + ':' + Number(port)
		);
	} catch {
		return false;
	}
}

export function readAgentIntegrationConfiguration(input: unknown): AgentIntegrationConfiguration {
	if (input !== null && typeof input === 'object' && 'kind' in input && input.kind === 'mcp') {
		const row = agentRecord(
			input,
			['kind', 'displayName', 'endpoint', 'privateHostExceptions', 'protocolVersion'],
			AGENT_INTEGRATION_MAX_BODY_BYTES,
		);
		const endpoint = agentText(row.endpoint, AGENT_MCP_ENDPOINT_MAX_BYTES);
		let url: URL;
		try {
			url = new URL(endpoint);
		} catch {
			throw new InvalidAgentPayload();
		}
		if (
			!['https:', 'http:'].includes(url.protocol) ||
			new TextEncoder().encode(url.toString()).byteLength > AGENT_MCP_ENDPOINT_MAX_BYTES ||
			url.username ||
			url.password ||
			url.hash ||
			row.protocolVersion !== AGENT_MCP_PROTOCOL_VERSION
		) {
			throw new InvalidAgentPayload();
		}
		const hosts = list(row.privateHostExceptions, AGENT_MCP_HOST_MAX_ITEMS, AGENT_MCP_HOST_MAX_BYTES);
		if (new Set(hosts).size !== hosts.length || hosts.some((host) => !authority(host))) {
			throw new InvalidAgentPayload();
		}
		return {
			kind: 'mcp',
			displayName: agentText(row.displayName, AGENT_INTEGRATION_NAME_MAX_BYTES),
			endpoint: url.toString(),
			privateHostExceptions: hosts,
			protocolVersion: AGENT_MCP_PROTOCOL_VERSION,
		};
	}
	const row = agentRecord(
		input,
		['kind', 'displayName', 'connectionId', 'argv', 'cwd', 'protocolVersion'],
		AGENT_INTEGRATION_MAX_BODY_BYTES,
	);
	const argv = list(row.argv, AGENT_ACP_ARGV_MAX_ITEMS, AGENT_ACP_ARGV_MAX_BYTES),
		cwd = agentText(row.cwd, AGENT_ACP_CWD_MAX_BYTES);
	if (
		row.kind !== 'acp' ||
		row.protocolVersion !== '1' ||
		!argv[0] ||
		argv[0].startsWith('-') ||
		new TextEncoder().encode(argv.join('')).byteLength > AGENT_ACP_ARGV_MAX_BYTES ||
		argv.some((arg) => arg.includes('\0')) ||
		!cwd.startsWith('/') ||
		cwd.split('/').includes('..') ||
		/[\u0000-\u001f\u007f]/u.test(cwd)
	) {
		throw new InvalidAgentPayload();
	}
	return {
		kind: 'acp',
		displayName: agentText(row.displayName, AGENT_INTEGRATION_NAME_MAX_BYTES),
		connectionId: agentInteger(row.connectionId, 1),
		argv,
		cwd,
		protocolVersion: '1',
	};
}

function credential(input: unknown): AgentIntegrationCredential {
	if (input !== null && typeof input === 'object' && 'action' in input && input.action === 'replace') {
		const row = agentRecord(input, ['action', 'value']);
		const value = agentText(row.value, 8192);
		if (/[\r\n\0]/u.test(value)) {
			throw new InvalidAgentPayload();
		}
		return { action: 'replace', value };
	}
	const row = agentRecord(input, ['action']);
	if (row.action !== 'keep' && row.action !== 'clear') {
		throw new InvalidAgentPayload();
	}
	return { action: row.action };
}

function boolean(input: unknown): boolean {
	if (typeof input !== 'boolean') {
		throw new InvalidAgentPayload();
	}
	return input;
}

export function readAgentIntegrationCreate(input: unknown): AgentIntegrationCreateRequest {
	const row = agentRecord(input, ['configuration', 'enabled', 'credential'], AGENT_INTEGRATION_MAX_BODY_BYTES);
	return {
		configuration: readAgentIntegrationConfiguration(row.configuration),
		enabled: boolean(row.enabled),
		credential: credential(row.credential),
	};
}

export function readAgentIntegrationUpdate(input: unknown): AgentIntegrationUpdateRequest {
	const row = agentRecord(
		input,
		['configuration', 'enabled', 'credential', 'expectedVersion'],
		AGENT_INTEGRATION_MAX_BODY_BYTES,
	);
	return {
		configuration: readAgentIntegrationConfiguration(row.configuration),
		enabled: boolean(row.enabled),
		credential: credential(row.credential),
		expectedVersion: agentInteger(row.expectedVersion, 1),
	};
}

export function readAgentIntegrationVersion(input: unknown): number {
	return agentInteger(agentRecord(input, ['expectedVersion']).expectedVersion, 1);
}

export function readAgentIntegrationCreateHeaders(input: unknown): AgentIntegrationCreateHeaders {
	const row = agentRecord(input, ['idempotencyKey']);
	return { idempotencyKey: readAgentId(row.idempotencyKey) };
}

export function readAgentIntegrationDeleteResponse(input: unknown): AgentIntegrationDeleteResponse {
	const row = agentRecord(input, ['status']);
	if (row.status !== 'deleted') {
		throw new InvalidAgentPayload();
	}
	return { status: 'deleted' };
}

export function readAgentIntegrationPath(input: unknown): { appId: string; integrationId: string } {
	const row = agentRecord(input, ['appId', 'integrationId']);
	return { appId: readAgentId(row.appId), integrationId: readAgentId(row.integrationId) };
}

export function readAgentIntegrationView(input: unknown): AgentIntegrationView {
	const row = agentRecord(
		input,
		[
			'id',
			'appId',
			'configuration',
			'enabled',
			'hasCredential',
			'credentialRevision',
			'schemaHash',
			'version',
			'createdAt',
			'updatedAt',
		],
		AGENT_INTEGRATION_MAX_RESPONSE_BYTES,
	);
	const hash = row.schemaHash === null ? null : agentText(row.schemaHash, 64);
	if (hash !== null && !/^[a-f0-9]{64}$/u.test(hash)) {
		throw new InvalidAgentPayload();
	}
	const createdAt = agentInteger(row.createdAt);
	const updatedAt = agentInteger(row.updatedAt);
	if (updatedAt < createdAt) {
		throw new InvalidAgentPayload();
	}
	return {
		id: readAgentId(row.id),
		appId: readAgentId(row.appId),
		configuration: readAgentIntegrationConfiguration(row.configuration),
		enabled: boolean(row.enabled),
		hasCredential: boolean(row.hasCredential),
		credentialRevision: agentInteger(row.credentialRevision),
		schemaHash: hash,
		version: agentInteger(row.version, 1),
		createdAt,
		updatedAt,
	};
}

export function readAgentIntegrationList(input: unknown): { items: AgentIntegrationView[] } {
	const row = agentRecord(input, ['items'], AGENT_INTEGRATION_MAX_RESPONSE_BYTES);
	if (!Array.isArray(row.items) || row.items.length > AGENT_INTEGRATION_MAX_ITEMS) {
		throw new InvalidAgentPayload();
	}
	const items = row.items.map(readAgentIntegrationView);
	if (new Set(items.map((item) => item.id)).size !== items.length) {
		throw new InvalidAgentPayload();
	}
	return { items };
}

export function readAgentIntegrationDiscovery(input: unknown): AgentIntegrationDiscovery {
	const row = agentRecord(
		input,
		['integration', 'serverName', 'serverVersion', 'protocolVersion', 'tools', 'resources', 'prompts'],
		AGENT_INTEGRATION_MAX_RESPONSE_BYTES,
	);
	if (
		!Array.isArray(row.tools) ||
		row.tools.length > 256 ||
		!Array.isArray(row.resources) ||
		row.resources.length > 2048 ||
		!Array.isArray(row.prompts) ||
		row.prompts.length > 512
	) {
		throw new InvalidAgentPayload();
	}
	const tools = row.tools.map((item) => {
		const value = agentRecord(
			item,
			['name', 'description', 'inputSchemaJson'],
			AGENT_INTEGRATION_MAX_RESPONSE_BYTES,
		);
		return {
			name: agentText(value.name, 1024),
			description: agentText(value.description, 32768),
			inputSchemaJson: agentText(value.inputSchemaJson, 1024 * 1024),
		};
	});
	const resources = row.resources.map((item) => {
		const value = agentRecord(item, ['uri', 'name']);
		return { uri: agentText(value.uri, 4096), name: agentText(value.name, 1024) };
	});
	const prompts = row.prompts.map((item) => {
		const value = agentRecord(item, ['name', 'description'], AGENT_INTEGRATION_MAX_RESPONSE_BYTES);
		return { name: agentText(value.name, 1024), description: agentText(value.description, 32768) };
	});
	return {
		integration: readAgentIntegrationView(row.integration),
		serverName: agentText(row.serverName, 1024),
		serverVersion: agentText(row.serverVersion, 1024),
		protocolVersion: agentText(row.protocolVersion, 64),
		tools,
		resources,
		prompts,
	};
}
