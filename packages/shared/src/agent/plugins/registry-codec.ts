import { AGENT_PLUGIN_RESOURCE_RELEASE_KEY, AGENT_PLUGIN_INSTANCE_PREPARE_KEY } from './runtime.js';
import { AGENT_CAPABILITIES } from '../governance/values.js';
import { AGENT_OPERATION_ERROR_CODES } from '../values.js';
import {
	agentRecord,
	agentInteger,
	encodeAgentJson,
	isAgentRecord,
	readAgentId,
	InvalidAgentPayload,
} from '../http-codec.js';
import { AGENT_PLUGIN_MAX_MESSAGE_BYTES } from './values.js';
import { AGENT_PLUGIN_CALLABLE_KINDS } from './registry.js';
import type {
	AgentPluginRegistrationDefinition,
	AgentPluginRegistryEntry,
	AgentPluginBinding,
	AgentPluginInvocation,
	AgentPluginInvocationReply,
	AgentPluginInstanceEvent,
	AgentPluginDirectoryPage,
	AgentPluginDescription,
} from './registry.js';

const budget = AGENT_PLUGIN_MAX_MESSAGE_BYTES - 1024;

export function pluginContractText(value: unknown): string {
	if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
		throw new InvalidAgentPayload();
	}
	return value;
}

function schema(value: unknown): string {
	const json = pluginContractText(value);
	try {
		const parsed: unknown = JSON.parse(json);
		if (!isAgentRecord(parsed)) {
			throw new InvalidAgentPayload();
		}
		encodeAgentJson(parsed, budget);
	} catch {
		throw new InvalidAgentPayload();
	}
	return json;
}

function strings(value: unknown): string[] {
	if (!Array.isArray(value)) {
		throw new InvalidAgentPayload();
	}
	const result = value.map(pluginContractText);
	if (new Set(result).size !== result.length) {
		throw new InvalidAgentPayload();
	}
	return result;
}

function namespace(value: unknown): string {
	const result = pluginContractText(value);
	if (!/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/u.test(result)) {
		throw new InvalidAgentPayload();
	}
	return result;
}

export function readAgentPluginRegistration(input: unknown): AgentPluginRegistrationDefinition {
	if (!isAgentRecord(input)) {
		throw new InvalidAgentPayload();
	}
	const row = agentRecord(
		input,
		input.kind === 'event'
			? ['kind', 'key', 'contract', 'apiVersion', 'summary', 'payloadSchemaJson', 'source']
			: [
					'kind',
					'key',
					'contract',
					'apiVersion',
					'summary',
					'instructions',
					'inputSchemaJson',
					'resultSchemaJson',
					'capabilities',
					'tags',
					'execution',
				],
		budget,
	);
	const key = pluginContractText(row.key);
	if (key === AGENT_PLUGIN_RESOURCE_RELEASE_KEY || key === AGENT_PLUGIN_INSTANCE_PREPARE_KEY) {
		throw new InvalidAgentPayload();
	}
	const contract = namespace(row.contract);
	const apiVersion = agentInteger(row.apiVersion, 1);
	const summary = pluginContractText(row.summary);
	if (row.kind === 'event') {
		if (!isAgentRecord(row.source)) {
			throw new InvalidAgentPayload();
		}
		if (row.source.kind === 'transient') {
			agentRecord(row.source, ['kind']);
			return {
				kind: 'event',
				key,
				contract,
				apiVersion,
				summary,
				payloadSchemaJson: schema(row.payloadSchemaJson),
				source: { kind: 'transient' },
			};
		}
		const source = agentRecord(row.source, ['kind', 'callableKey']);
		if (source.kind !== 'snapshot' && source.kind !== 'cursor') {
			throw new InvalidAgentPayload();
		}
		return {
			kind: 'event',
			key,
			contract,
			apiVersion,
			summary,
			payloadSchemaJson: schema(row.payloadSchemaJson),
			source: { kind: source.kind, callableKey: pluginContractText(source.callableKey) },
		};
	}
	const kind = AGENT_PLUGIN_CALLABLE_KINDS.find((kind) => kind === row.kind);
	if (
		!kind ||
		!Array.isArray(row.capabilities) ||
		(row.execution !== 'pure' && row.execution !== 'managed') ||
		typeof row.instructions !== 'string'
	) {
		throw new InvalidAgentPayload();
	}
	const capabilities = row.capabilities.map((value) => {
		const capability = AGENT_CAPABILITIES.find((capability) => capability === value);
		if (!capability) {
			throw new InvalidAgentPayload();
		}
		return capability;
	});
	if (new Set(capabilities).size !== capabilities.length) {
		throw new InvalidAgentPayload();
	}
	return {
		kind,
		key,
		contract,
		apiVersion,
		summary,
		instructions: row.instructions,
		inputSchemaJson: schema(row.inputSchemaJson),
		resultSchemaJson: schema(row.resultSchemaJson),
		capabilities,
		tags: strings(row.tags),
		execution: row.execution,
	};
}

export function readAgentPluginRegistrations(input: unknown): AgentPluginRegistrationDefinition[] {
	if (!Array.isArray(input)) {
		throw new InvalidAgentPayload();
	}
	encodeAgentJson(input, budget);
	const values = input.map(readAgentPluginRegistration);
	if (new Set(values.map((value) => value.key)).size !== values.length) {
		throw new InvalidAgentPayload();
	}
	for (const value of values) {
		if (value.kind === 'event' && value.source.kind !== 'transient') {
			const sourceKey = value.source.callableKey;
			if (!values.some((entry) => entry.kind !== 'event' && entry.key === sourceKey)) {
				throw new InvalidAgentPayload();
			}
		}
	}
	return values;
}

export function readAgentPluginRegistryEntry(input: unknown): AgentPluginRegistryEntry {
	const row = agentRecord(
		input,
		['id', 'instanceId', 'package', 'generation', 'key', 'kind', 'contract', 'apiVersion', 'summary', 'tags'],
		budget,
	);
	const pkg = agentRecord(row.package, ['packageId', 'version', 'packageHash', 'publisherKeyId']);
	const kind = row.kind === 'event' ? 'event' : AGENT_PLUGIN_CALLABLE_KINDS.find((value) => value === row.kind);
	if (!kind) {
		throw new InvalidAgentPayload();
	}
	return {
		id: readAgentId(row.id),
		instanceId: readAgentId(row.instanceId),
		generation: readAgentId(row.generation),
		key: pluginContractText(row.key),
		kind,
		contract: namespace(row.contract),
		apiVersion: agentInteger(row.apiVersion, 1),
		summary: pluginContractText(row.summary),
		tags: strings(row.tags),
		package: {
			packageId: pluginContractText(pkg.packageId),
			version: pluginContractText(pkg.version),
			packageHash: pluginContractText(pkg.packageHash),
			publisherKeyId: pluginContractText(pkg.publisherKeyId),
		},
	};
}

export function readAgentPluginDirectoryPage(input: unknown): AgentPluginDirectoryPage {
	const row = agentRecord(input, ['revision', 'entries', 'nextCursor'], budget);
	if (!Array.isArray(row.entries)) {
		throw new InvalidAgentPayload();
	}
	const entries = row.entries.map(readAgentPluginRegistryEntry);
	if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
		throw new InvalidAgentPayload();
	}
	return {
		revision: agentInteger(row.revision),
		entries,
		nextCursor: row.nextCursor === null ? null : pluginContractText(row.nextCursor),
	};
}

export function readAgentPluginDescription(input: unknown): AgentPluginDescription {
	const row = agentRecord(input, ['entry', 'definition', 'schemaSha256'], budget);
	const entry = readAgentPluginRegistryEntry(row.entry);
	const definition = readAgentPluginRegistration(row.definition);
	if (
		entry.key !== definition.key ||
		entry.kind !== definition.kind ||
		entry.contract !== definition.contract ||
		entry.apiVersion !== definition.apiVersion
	) {
		throw new InvalidAgentPayload();
	}
	return { entry, definition, schemaSha256: digest(row.schemaSha256) };
}

function digest(input: unknown): string {
	if (typeof input !== 'string' || !/^[0-9a-f]{64}$/u.test(input)) {
		throw new InvalidAgentPayload();
	}
	return input;
}

export function readAgentPluginBinding(input: unknown): AgentPluginBinding {
	const row = agentRecord(input, [
		'id',
		'entryId',
		'instanceId',
		'generation',
		'configurationRevision',
		'schemaSha256',
	]);
	return {
		id: readAgentId(row.id),
		entryId: readAgentId(row.entryId),
		instanceId: readAgentId(row.instanceId),
		generation: readAgentId(row.generation),
		configurationRevision: agentInteger(row.configurationRevision),
		schemaSha256: digest(row.schemaSha256),
	};
}

export function readAgentPluginInvocation(input: unknown): AgentPluginInvocation {
	const row = agentRecord(input, ['bindingId', 'operationKey', 'argumentsJson'], budget);
	if (typeof row.argumentsJson !== 'string') {
		throw new InvalidAgentPayload();
	}
	try {
		encodeAgentJson(JSON.parse(row.argumentsJson), budget);
	} catch {
		throw new InvalidAgentPayload();
	}
	return {
		bindingId: readAgentId(row.bindingId),
		operationKey: pluginContractText(row.operationKey),
		argumentsJson: row.argumentsJson,
	};
}

export function readAgentPluginInvocationReply(input: unknown): AgentPluginInvocationReply {
	if (!isAgentRecord(input)) {
		throw new InvalidAgentPayload();
	}
	if (input.kind === 'rejected') {
		const row = agentRecord(input, ['kind', 'code']);
		const code = AGENT_OPERATION_ERROR_CODES.find((code) => code === row.code);
		if (!code) {
			throw new InvalidAgentPayload();
		}
		return { kind: 'rejected', code };
	}
	if (input.kind === 'interrupted') {
		const row = agentRecord(input, ['kind', 'operationId', 'reason']);
		if (row.reason !== 'cancelled' && row.reason !== 'effect_unknown' && row.reason !== 'cleanup_failed') {
			throw new InvalidAgentPayload();
		}
		return { kind: 'interrupted', operationId: readAgentId(row.operationId), reason: row.reason };
	}
	const row = agentRecord(input, ['kind', 'operationId', 'resultJson'], budget);
	if (row.kind !== 'completed' || typeof row.resultJson !== 'string') {
		throw new InvalidAgentPayload();
	}
	try {
		encodeAgentJson(JSON.parse(row.resultJson), budget);
	} catch {
		throw new InvalidAgentPayload();
	}
	return {
		kind: 'completed',
		operationId: row.operationId === null ? null : readAgentId(row.operationId),
		resultJson: row.resultJson,
	};
}

export function readAgentPluginInstanceEvent(input: unknown): AgentPluginInstanceEvent {
	const row = agentRecord(input, ['instanceId', 'generation', 'key', 'revision', 'cursor', 'payloadJson'], budget);
	if (typeof row.payloadJson !== 'string') {
		throw new InvalidAgentPayload();
	}
	try {
		encodeAgentJson(JSON.parse(row.payloadJson), budget);
	} catch {
		throw new InvalidAgentPayload();
	}
	return {
		instanceId: readAgentId(row.instanceId),
		generation: readAgentId(row.generation),
		key: pluginContractText(row.key),
		revision: agentInteger(row.revision),
		cursor: row.cursor === null ? null : pluginContractText(row.cursor),
		payloadJson: row.payloadJson,
	};
}
