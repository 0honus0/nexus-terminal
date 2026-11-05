import { AGENT_APP_EXECUTION_STATE } from './values.js';
import {
	AGENT_THREAD_ENTRY_MAX_PAGE,
	AGENT_THREAD_ENTRY_MAX_TEXT_CODE_POINTS,
	AGENT_THREAD_ENTRY_MAX_TEXT_BYTES,
	AGENT_THREAD_ENTRIES_MAX_RESPONSE_BYTES,
} from './values.js';
import type { AgentThreadEntryCursor, AgentThreadEntries, AgentThreadEntry, AgentThreadEntryHistory } from './model.js';
import {
	InvalidAgentPayload,
	encodeAgentJson,
	agentRecord,
	agentInteger,
	agentText,
	readAgentId,
} from '../http-codec.js';
import {
	AGENT_APP_MAX_RESPONSE_BYTES,
	AGENT_APP_MAX_LIST_ITEMS,
	AGENT_APP_DEFINITION_ID_PATTERN,
	AGENT_APP_MAX_DEFINITION_ID_BYTES,
	AGENT_APP_MAX_DEFINITION_VERSION_BYTES,
	AGENT_SCOPE_MAX_NAME_BYTES,
} from './values.js';
import { AGENT_MAX_JSON_BODY_BYTES } from '../values.js';
import { AGENT_CAPABILITIES } from '../governance/values.js';
import type { AgentCapability } from '../governance/values.js';
import type { AgentAppView, AgentAppDefinitionView } from './model.js';
import type { AgentAppStateUpdateRequest } from './http.js';

import type { AgentAppPath, AgentCreateThreadRequest, AgentCreateThreadResponse } from './http.js';

export function readAgentAppPath(input: unknown): AgentAppPath {
	return { appId: readAgentId(agentRecord(input, ['appId']).appId) };
}

export function readAgentCreateThreadRequest(input: unknown): AgentCreateThreadRequest {
	return {
		title: agentText(agentRecord(input, ['title'], AGENT_MAX_JSON_BODY_BYTES).title, AGENT_SCOPE_MAX_NAME_BYTES),
	};
}

function readDefinitionId(input: unknown): string {
	const id = agentText(input, AGENT_APP_MAX_DEFINITION_ID_BYTES);
	if (!AGENT_APP_DEFINITION_ID_PATTERN.test(id)) {
		throw new InvalidAgentPayload();
	}
	return id;
}

function readCapabilities(input: unknown): AgentCapability[] {
	if (!Array.isArray(input) || input.length > AGENT_CAPABILITIES.length || new Set(input).size !== input.length) {
		throw new InvalidAgentPayload();
	}
	return input.map((value) => {
		const capability = AGENT_CAPABILITIES.find((item) => item === value);
		if (capability === undefined) {
			throw new InvalidAgentPayload();
		}
		return capability;
	});
}

function readApp(input: unknown): AgentAppView {
	const row = agentRecord(input, [
		'id',
		'name',
		'definitionId',
		'definitionVersion',
		'capabilities',
		'enabled',
		'version',
		'executionState',
		'createdAt',
		'updatedAt',
	]);
	if (typeof row.enabled !== 'boolean' || row.executionState !== AGENT_APP_EXECUTION_STATE) {
		throw new InvalidAgentPayload();
	}
	const capabilities = readCapabilities(row.capabilities);
	const createdAt = agentInteger(row.createdAt);
	const updatedAt = agentInteger(row.updatedAt, createdAt);
	return {
		id: readAgentId(row.id),
		name: agentText(row.name, AGENT_SCOPE_MAX_NAME_BYTES),
		definitionId: readDefinitionId(row.definitionId),
		definitionVersion: agentText(row.definitionVersion, AGENT_APP_MAX_DEFINITION_VERSION_BYTES),
		capabilities,
		enabled: row.enabled,
		version: agentInteger(row.version, 1),
		executionState: row.executionState,
		createdAt,
		updatedAt,
	};
}

export function readAgentAppResponse(input: unknown): AgentAppView {
	return readApp(input);
}

export function readAgentAppListResponse(input: unknown): AgentAppView[] {
	encodeAgentJson(input, AGENT_APP_MAX_RESPONSE_BYTES);
	if (!Array.isArray(input) || input.length > AGENT_APP_MAX_LIST_ITEMS) {
		throw new InvalidAgentPayload();
	}
	const result = input.map(readApp);
	if (new Set(result.map((app) => app.id)).size !== result.length) {
		throw new InvalidAgentPayload();
	}
	return result;
}

export function readAgentAppDefinitionListResponse(input: unknown): AgentAppDefinitionView[] {
	encodeAgentJson(input, AGENT_APP_MAX_RESPONSE_BYTES);
	if (!Array.isArray(input) || input.length > AGENT_APP_MAX_LIST_ITEMS) {
		throw new InvalidAgentPayload();
	}
	const result = input.map((value) => {
		const row = agentRecord(value, ['id', 'version', 'displayName', 'capabilities']);
		return {
			id: readDefinitionId(row.id),
			version: agentText(row.version, AGENT_APP_MAX_DEFINITION_VERSION_BYTES),
			displayName: agentText(row.displayName, AGENT_SCOPE_MAX_NAME_BYTES),
			capabilities: readCapabilities(row.capabilities),
		};
	});
	if (new Set(result.map((definition) => definition.id)).size !== result.length) {
		throw new InvalidAgentPayload();
	}
	return result;
}

export function readAgentAppStateUpdateRequest(input: unknown): AgentAppStateUpdateRequest {
	const row = agentRecord(input, ['enabled', 'expectedVersion'], AGENT_MAX_JSON_BODY_BYTES);
	if (typeof row.enabled !== 'boolean') {
		throw new InvalidAgentPayload();
	}
	return { enabled: row.enabled, expectedVersion: agentInteger(row.expectedVersion, 1) };
}

export function readAgentCreateThreadResponse(input: unknown): AgentCreateThreadResponse {
	const row = agentRecord(input, ['id', 'appId', 'title', 'version', 'createdAt', 'updatedAt']);
	const createdAt = agentInteger(row.createdAt);
	return {
		id: readAgentId(row.id),
		appId: readAgentId(row.appId),
		title: agentText(row.title, AGENT_SCOPE_MAX_NAME_BYTES),
		version: agentInteger(row.version, 1),
		createdAt,
		updatedAt: agentInteger(row.updatedAt, createdAt),
	};
}

export function readAgentThreadEntryCursor(input: unknown): AgentThreadEntryCursor {
	const row = agentRecord(input, ['runSequence', 'stepIndex', 'eventSequence', 'textOffset']);
	const value = {
		runSequence: agentInteger(row.runSequence, 0, Number.MAX_SAFE_INTEGER - 1),
		stepIndex: agentInteger(row.stepIndex, 0, Number.MAX_SAFE_INTEGER - 1),
		eventSequence: agentInteger(row.eventSequence, 0, Number.MAX_SAFE_INTEGER - 1),
		textOffset: agentInteger(row.textOffset, 0, Number.MAX_SAFE_INTEGER - 1),
	};
	if (
		(value.runSequence === 0 && (value.stepIndex !== 0 || value.eventSequence !== 0 || value.textOffset !== 0)) ||
		(value.stepIndex === 0) !== (value.eventSequence === 0)
	) {
		throw new InvalidAgentPayload();
	}
	return value;
}

function compareEntry(a: AgentThreadEntryCursor, b: AgentThreadEntryCursor): number {
	return a.runSequence - b.runSequence || a.stepIndex - b.stepIndex || a.eventSequence - b.eventSequence;
}

export function readAgentThreadEntries(
	input: unknown,
	threadId: string,
	after: AgentThreadEntryCursor,
	limit: number,
): AgentThreadEntries {
	const row = agentRecord(
		input,
		['appId', 'threadId', 'items', 'nextCursor'],
		AGENT_THREAD_ENTRIES_MAX_RESPONSE_BYTES,
	);
	if (
		row.threadId !== threadId ||
		!Array.isArray(row.items) ||
		row.items.length > limit ||
		limit > AGENT_THREAD_ENTRY_MAX_PAGE
	) {
		throw new InvalidAgentPayload();
	}
	let previous = after;
	const items = row.items.map((raw: unknown): AgentThreadEntry => {
		const p = agentRecord(raw, ['runId', 'role', 'position', 'text'], AGENT_THREAD_ENTRIES_MAX_RESPONSE_BYTES);
		const position = readAgentThreadEntryCursor(p.position);
		if (
			typeof p.text !== 'string' ||
			new TextEncoder().encode(p.text).byteLength > AGENT_THREAD_ENTRY_MAX_TEXT_BYTES ||
			/[\uD800-\uDFFF]/u.test(p.text)
		) {
			throw new InvalidAgentPayload();
		}
		const text = p.text;
		const points = Array.from(text).length;
		const order = compareEntry(position, previous);
		if (
			(p.role !== 'user' && p.role !== 'assistant') ||
			!points ||
			points > AGENT_THREAD_ENTRY_MAX_TEXT_CODE_POINTS ||
			(p.role === 'user') !== (position.stepIndex === 0) ||
			!position.runSequence ||
			order < 0 ||
			position.textOffset !== (order === 0 ? previous.textOffset : 0) + points
		) {
			throw new InvalidAgentPayload();
		}
		previous = position;
		return { runId: readAgentId(p.runId), role: p.role, position, text };
	});
	const nextCursor = readAgentThreadEntryCursor(row.nextCursor);
	if (compareEntry(nextCursor, previous) !== 0 || nextCursor.textOffset !== previous.textOffset) {
		throw new InvalidAgentPayload();
	}
	return { appId: readAgentId(row.appId), threadId, items, nextCursor };
}

export function readAgentThreadEntryHistory(
	input: unknown,
	threadId: string,
	before: AgentThreadEntryCursor | null,
	limit: number,
): AgentThreadEntryHistory {
	const row = agentRecord(input, ['body', 'startCursor', 'hasEarlier'], AGENT_THREAD_ENTRIES_MAX_RESPONSE_BYTES);
	const startCursor = readAgentThreadEntryCursor(row.startCursor);
	const body = readAgentThreadEntries(row.body, threadId, startCursor, limit);
	if (
		typeof row.hasEarlier !== 'boolean' ||
		(!body.items.length && row.hasEarlier) ||
		(body.items.length > 0 && startCursor.textOffset > 0 && !row.hasEarlier)
	) {
		throw new InvalidAgentPayload();
	}
	const first = body.items[0];
	if (
		first &&
		(compareEntry(first.position, startCursor) !== 0 ||
			first.position.textOffset - Array.from(first.text).length !== startCursor.textOffset)
	) {
		throw new InvalidAgentPayload();
	}
	if (before) {
		const order = compareEntry(body.nextCursor, before) || body.nextCursor.textOffset - before.textOffset;
		if (order > 0 || (before.textOffset > 0 && order !== 0)) {
			throw new InvalidAgentPayload();
		}
	}
	if (!body.items.length) {
		const expected = before ?? { runSequence: 0, stepIndex: 0, eventSequence: 0, textOffset: 0 };
		if (compareEntry(startCursor, expected) !== 0 || startCursor.textOffset !== expected.textOffset) {
			throw new InvalidAgentPayload();
		}
	}
	return { body, startCursor, hasEarlier: row.hasEarlier };
}
