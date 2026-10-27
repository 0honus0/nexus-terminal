import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import type {
	StoredIntegration,
	StoredIntegrationConfiguration,
	StoredIntegrationReceipt,
} from '../../storage/integration-storage.js';
import { AGENT_ID_PATTERN } from '@nexus-terminal/shared/agent/values';
import {
	AGENT_MCP_PROTOCOL_VERSION,
	AGENT_INTEGRATION_MAX_BODY_BYTES,
	AGENT_INTEGRATION_NAME_MAX_BYTES,
	AGENT_MCP_ENDPOINT_MAX_BYTES,
	AGENT_MCP_HOST_MAX_ITEMS,
	AGENT_MCP_HOST_MAX_BYTES,
	AGENT_ACP_ARGV_MAX_ITEMS,
	AGENT_ACP_ARGV_MAX_BYTES,
	AGENT_ACP_CWD_MAX_BYTES,
} from '@nexus-terminal/shared/agent/integrations/values';

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
	if (!isRecord(value)) {
		throw new Error('Invalid integration record');
	}
	return value;
}

function text(value: unknown, max = Number.MAX_SAFE_INTEGER): string {
	if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > max) {
		throw new Error('Invalid integration text');
	}
	return value;
}

function integer(value: unknown, min = 0): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
		throw new Error('Invalid integration integer');
	}
	return value;
}

function texts(value: unknown, maxItems: number, maxBytes: number): string[] {
	if (!Array.isArray(value) || value.length > maxItems) {
		throw new Error('Invalid integration list');
	}
	return value.map((item) => text(item, maxBytes));
}

function id(value: unknown): string {
	const result = text(value);
	if (!AGENT_ID_PATTERN.test(result) || result !== result.toLowerCase()) {
		throw new Error('Invalid integration identity');
	}
	return result;
}

function privateAuthority(value: string): boolean {
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

function configuration(raw: unknown): StoredIntegrationConfiguration {
	const row = record(raw);
	if (Buffer.byteLength(JSON.stringify(row)) > AGENT_INTEGRATION_MAX_BODY_BYTES) {
		throw new Error('Invalid integration configuration size');
	}
	if (row.kind === 'mcp' && row.protocolVersion === AGENT_MCP_PROTOCOL_VERSION) {
		if (Object.keys(row).length !== 5) {
			throw new Error('Invalid MCP configuration');
		}
		const endpoint = text(row.endpoint, AGENT_MCP_ENDPOINT_MAX_BYTES);
		const url = new URL(endpoint);
		const hosts = texts(row.privateHostExceptions, AGENT_MCP_HOST_MAX_ITEMS, AGENT_MCP_HOST_MAX_BYTES);
		if (
			!['https:', 'http:'].includes(url.protocol) ||
			url.username ||
			url.password ||
			url.hash ||
			endpoint !== url.toString() ||
			new Set(hosts).size !== hosts.length ||
			hosts.some((host) => !privateAuthority(host))
		) {
			throw new Error('Invalid MCP endpoint');
		}
		return {
			kind: 'mcp',
			displayName: text(row.displayName, AGENT_INTEGRATION_NAME_MAX_BYTES),
			endpoint,
			privateHostExceptions: hosts,
			protocolVersion: AGENT_MCP_PROTOCOL_VERSION,
		};
	}
	if (row.kind === 'acp' && row.protocolVersion === '1') {
		if (Object.keys(row).length !== 6) {
			throw new Error('Invalid ACP configuration');
		}
		const argv = texts(row.argv, AGENT_ACP_ARGV_MAX_ITEMS, AGENT_ACP_ARGV_MAX_BYTES);
		const cwd = text(row.cwd, AGENT_ACP_CWD_MAX_BYTES);
		if (
			!argv[0] ||
			argv[0].startsWith('-') ||
			Buffer.byteLength(argv.join('')) > AGENT_ACP_ARGV_MAX_BYTES ||
			argv.some((arg) => arg.includes('\0')) ||
			!cwd.startsWith('/') ||
			cwd.split('/').includes('..') ||
			/[\u0000-\u001f\u007f]/u.test(cwd)
		) {
			throw new Error('Invalid ACP execution configuration');
		}
		return {
			kind: 'acp',
			displayName: text(row.displayName, AGENT_INTEGRATION_NAME_MAX_BYTES),
			connectionId: integer(row.connectionId, 1),
			argv,
			cwd,
			protocolVersion: '1',
		};
	}
	throw new Error('Invalid integration kind');
}

export function integrationRow(row: SqlRow): StoredIntegration {
	if (row.enabled !== 0 && row.enabled !== 1) {
		throw new Error('Invalid integration flag');
	}
	const createdAt = integer(row.created_at);
	const schemaHash = row.schema_hash === null ? null : text(row.schema_hash, 64);
	if (schemaHash !== null && !/^[a-f0-9]{64}$/u.test(schemaHash)) {
		throw new Error('Invalid integration schema hash');
	}
	return {
		id: id(row.id),
		appId: id(row.app_id),
		configuration: configuration(JSON.parse(text(row.configuration_json, AGENT_INTEGRATION_MAX_BODY_BYTES))),
		enabled: row.enabled === 1,
		encryptedCredential: row.encrypted_credential === null ? null : text(row.encrypted_credential),
		credentialRevision: integer(row.credential_revision),
		schemaHash,
		version: integer(row.version, 1),
		createdAt,
		updatedAt: integer(row.updated_at, createdAt),
	};
}

export function integrationReceipt(row: SqlRow): StoredIntegrationReceipt {
	const value = record(JSON.parse(text(row.result_json)));
	if (
		Object.keys(value).length !== 10 ||
		typeof value.enabled !== 'boolean' ||
		typeof value.hasCredential !== 'boolean' ||
		value.id !== row.integration_id ||
		value.appId !== row.app_id ||
		value.version !== 1 ||
		value.schemaHash !== null ||
		value.credentialRevision !== (value.hasCredential ? 1 : 0) ||
		value.updatedAt !== value.createdAt
	) {
		throw new Error('Invalid integration creation receipt');
	}
	return {
		id: id(value.id),
		appId: id(value.appId),
		configuration: configuration(value.configuration),
		enabled: value.enabled,
		hasCredential: value.hasCredential,
		credentialRevision: integer(value.credentialRevision),
		schemaHash: null,
		version: 1,
		createdAt: integer(value.createdAt),
		updatedAt: integer(value.updatedAt),
	};
}
