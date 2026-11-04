import { agentRecord, agentInteger, readAgentId, InvalidAgentPayload } from '../http-codec.js';
import { AGENT_PLUGIN_MAX_MESSAGE_BYTES } from './values.js';

/** Optional signed agent.json; absent means the App has no Agent contribution. */
export interface AgentPluginContribution {
	schemaVersion: 1;
	role: string;
	toolNames: string[] | null;
	beforeStep: boolean;
	tools: { name: string; description: string }[];
}

export type AgentPluginAgentRequest =
	| { kind: 'context'; runId: string; stepIndex: number; prompt: string }
	| { kind: 'tool'; runId: string; stepIndex: number; operationId: string; name: string; argumentsJson: string };

export interface AgentPluginAgentResult {
	text: string;
}

function text(value: unknown): string {
	if (typeof value !== 'string' || value.includes('\0')) {
		throw new InvalidAgentPayload();
	}
	return value;
}

function name(value: unknown): string {
	const result = text(value);
	if (!/^[a-z][a-z0-9_]{0,63}$/u.test(result)) {
		throw new InvalidAgentPayload();
	}
	return result;
}

export function readAgentPluginContribution(input: unknown): AgentPluginContribution {
	const row = agentRecord(
		input,
		['schemaVersion', 'role', 'toolNames', 'beforeStep', 'tools'],
		AGENT_PLUGIN_MAX_MESSAGE_BYTES - 1024,
	);
	if (
		row.schemaVersion !== 1 ||
		typeof row.beforeStep !== 'boolean' ||
		!Array.isArray(row.tools) ||
		(row.toolNames !== null && !Array.isArray(row.toolNames))
	) {
		throw new InvalidAgentPayload();
	}
	const toolNames = row.toolNames === null ? null : row.toolNames.map(name);
	const tools = row.tools.map((value) => {
		const tool = agentRecord(value, ['name', 'description'], AGENT_PLUGIN_MAX_MESSAGE_BYTES - 1024);
		const description = text(tool.description);
		if (!description.trim()) {
			throw new InvalidAgentPayload();
		}
		return { name: name(tool.name), description };
	});
	if (
		(toolNames !== null && new Set(toolNames).size !== toolNames.length) ||
		new Set(tools.map((tool) => tool.name)).size !== tools.length
	) {
		throw new InvalidAgentPayload();
	}
	return { schemaVersion: 1, role: text(row.role), toolNames, beforeStep: row.beforeStep, tools };
}

export function readAgentPluginAgentRequest(input: unknown): AgentPluginAgentRequest {
	const row = agentRecord(
		input,
		input !== null && typeof input === 'object' && 'kind' in input && input.kind === 'context'
			? ['kind', 'runId', 'stepIndex', 'prompt']
			: ['kind', 'runId', 'stepIndex', 'operationId', 'name', 'argumentsJson'],
		AGENT_PLUGIN_MAX_MESSAGE_BYTES - 1024,
	);
	const runId = readAgentId(row.runId);
	const stepIndex = agentInteger(row.stepIndex, 1, Number.MAX_SAFE_INTEGER);
	if (row.kind === 'context') {
		return { kind: 'context', runId, stepIndex, prompt: text(row.prompt) };
	}
	if (row.kind !== 'tool') {
		throw new InvalidAgentPayload();
	}
	const argumentsJson = text(row.argumentsJson);
	let args: unknown;
	try {
		args = JSON.parse(argumentsJson);
	} catch {
		throw new InvalidAgentPayload();
	}
	if (args === null || typeof args !== 'object' || Array.isArray(args)) {
		throw new InvalidAgentPayload();
	}
	return {
		kind: 'tool',
		runId,
		stepIndex,
		operationId: readAgentId(row.operationId),
		name: name(row.name),
		argumentsJson,
	};
}

export function readAgentPluginAgentResult(input: unknown): AgentPluginAgentResult {
	const row = agentRecord(input, ['text'], AGENT_PLUGIN_MAX_MESSAGE_BYTES - 1024);
	return { text: text(row.text) };
}
