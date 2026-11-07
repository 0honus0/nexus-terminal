import { AGENT_OPERATION_ERROR_CODES } from '../values.js';
import {
	agentInteger,
	agentRecord,
	encodeAgentJson,
	isAgentRecord,
	readAgentId,
	InvalidAgentPayload,
} from '../http-codec.js';
import { AGENT_PLUGIN_MAX_MESSAGE_BYTES } from './values.js';
import { pluginContractText } from './registry-codec.js';
import type {
	AgentPluginCapabilityReply,
	AgentPluginCapabilityRequest,
	AgentPluginCallScope,
	AgentPluginDispatchInput,
	AgentPluginRuntimeContext,
	AgentPluginDispatchReply,
} from './runtime.js';

const budget = AGENT_PLUGIN_MAX_MESSAGE_BYTES - 1024;

export function pluginJsonValue(input: unknown): string {
	if (typeof input !== 'string') {
		throw new InvalidAgentPayload();
	}
	try {
		const parsed: unknown = JSON.parse(input);
		return encodeAgentJson(parsed, budget);
	} catch {
		throw new InvalidAgentPayload();
	}
}

export function readAgentPluginCapabilityRequest(input: unknown): AgentPluginCapabilityRequest {
	const row = agentRecord(input, ['method', 'inputJson'], budget);
	return { method: pluginContractText(row.method), inputJson: pluginJsonValue(row.inputJson) };
}

/** Count the actual reply: native results are serialized inside the valueJson string. */
export function agentPluginCapabilityReplyBytes(value: unknown): number {
	return new TextEncoder().encode(JSON.stringify({ ok: true, valueJson: JSON.stringify(value) })).byteLength;
}

export function readAgentPluginCapabilityReply(input: unknown): AgentPluginCapabilityReply {
	if (!isAgentRecord(input)) {
		throw new InvalidAgentPayload();
	}
	if (input.ok === true) {
		const row = agentRecord(input, ['ok', 'valueJson'], budget);
		return { ok: true, valueJson: pluginJsonValue(row.valueJson) };
	}
	const row = agentRecord(input, ['ok', 'code'], budget);
	const code = AGENT_OPERATION_ERROR_CODES.find((code) => code === row.code);
	if (row.ok !== false || !code) {
		throw new InvalidAgentPayload();
	}
	return { ok: false, code };
}

export function readAgentPluginCallScope(input: unknown): AgentPluginCallScope {
	if (!isAgentRecord(input)) {
		throw new InvalidAgentPayload();
	}
	const row = agentRecord(
		input,
		input.kind === 'run' ? ['kind', 'runId', 'operationId', 'deadlineUnixMs'] : ['kind', 'deadlineUnixMs'],
		budget,
	);
	const deadlineUnixMs = agentInteger(row.deadlineUnixMs);
	if (row.kind === 'run') {
		return {
			kind: 'run',
			runId: readAgentId(row.runId),
			operationId: row.operationId === null ? null : readAgentId(row.operationId),
			deadlineUnixMs,
		};
	}
	if (row.kind !== 'settings' && row.kind !== 'lifecycle') {
		throw new InvalidAgentPayload();
	}
	return { kind: row.kind, deadlineUnixMs };
}

export function readAgentPluginDispatchInput(input: unknown): AgentPluginDispatchInput {
	const row = agentRecord(input, ['key', 'argumentsJson', 'scope'], budget);
	return {
		key: pluginContractText(row.key),
		argumentsJson: pluginJsonValue(row.argumentsJson),
		scope: readAgentPluginCallScope(row.scope),
	};
}

export function readAgentPluginDispatchReply(input: unknown): AgentPluginDispatchReply {
	if (!isAgentRecord(input)) {
		throw new InvalidAgentPayload();
	}
	if (Object.hasOwn(input, 'errorCode')) {
		const row = agentRecord(input, ['errorCode'], budget);
		const code = AGENT_OPERATION_ERROR_CODES.find((code) => code === row.errorCode);
		if (!code) {
			throw new InvalidAgentPayload();
		}
		return { errorCode: code };
	}
	return { resultJson: pluginJsonValue(agentRecord(input, ['resultJson'], budget).resultJson) };
}

export function readAgentPluginRuntimeContext(input: unknown): AgentPluginRuntimeContext {
	const row = agentRecord(
		input,
		['protocol', 'sdkVersion', 'appId', 'instanceId', 'generation', 'package', 'configurationRevision'],
		budget,
	);
	if (row.protocol !== 4 || row.sdkVersion !== '4') {
		throw new InvalidAgentPayload();
	}
	const pkg = agentRecord(row.package, ['packageId', 'version', 'packageHash', 'publisherKeyId']);
	return {
		protocol: 4,
		sdkVersion: '4',
		appId: readAgentId(row.appId),
		instanceId: readAgentId(row.instanceId),
		generation: readAgentId(row.generation),
		configurationRevision: agentInteger(row.configurationRevision),
		package: {
			packageId: pluginContractText(pkg.packageId),
			version: pluginContractText(pkg.version),
			packageHash: pluginContractText(pkg.packageHash),
			publisherKeyId: pluginContractText(pkg.publisherKeyId),
		},
	};
}
