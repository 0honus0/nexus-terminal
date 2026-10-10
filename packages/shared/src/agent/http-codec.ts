import { AGENT_HTTP_ERROR_CODES, AGENT_ID_PATTERN, AGENT_MAX_RESPONSE_BYTES } from './values.js';
import type { AgentErrorResponse } from './http.js';

export class InvalidAgentPayload extends Error {
	constructor() {
		super('invalid_agent_payload');
		this.name = 'InvalidAgentPayload';
	}
}

export function readAgentId(input: unknown): string {
	if (typeof input !== 'string' || !AGENT_ID_PATTERN.test(input)) {
		throw new InvalidAgentPayload();
	}
	return input.toLowerCase();
}

export function readAgentErrorResponse(input: unknown): AgentErrorResponse {
	const code = agentRecord(input, ['code']).code;
	for (const item of AGENT_HTTP_ERROR_CODES) {
		if (code === item) {
			return { code: item };
		}
	}
	throw new InvalidAgentPayload();
}

export function encodeAgentJson(input: unknown, maxBytes: number): string {
	const json = JSON.stringify(input);
	if (json === undefined || new TextEncoder().encode(json).byteLength > maxBytes) {
		throw new InvalidAgentPayload();
	}
	return json;
}

/** Inspect a JSON record before reading fields; never cast it to a business object. */
export function agentRecord(
	input: unknown,
	keys: readonly string[],
	maxBytes = AGENT_MAX_RESPONSE_BYTES,
): Record<string, unknown> {
	if (input === null || typeof input !== 'object' || Array.isArray(input)) {
		throw new InvalidAgentPayload();
	}
	encodeAgentJson(input, maxBytes);
	const row = input as Record<string, unknown>;
	if (Object.keys(row).some((key) => !keys.includes(key)) || keys.some((key) => !Object.hasOwn(row, key))) {
		throw new InvalidAgentPayload();
	}
	return row;
}

export function agentInteger(input: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
	if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < min || input > max) {
		throw new InvalidAgentPayload();
	}
	return input;
}

export function agentText(input: unknown, maxBytes: number): string {
	if (typeof input !== 'string' || !input.trim() || new TextEncoder().encode(input).byteLength > maxBytes) {
		throw new InvalidAgentPayload();
	}
	return input;
}
