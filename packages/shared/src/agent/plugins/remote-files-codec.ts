import { agentInteger, agentRecord, InvalidAgentPayload } from '../http-codec.js';
import {
	REMOTE_FILE_MAX_LIST_ENTRIES,
	REMOTE_FILE_MAX_PATH_BYTES,
	REMOTE_FILE_TEXT_PAGE_MAX_BYTES,
	REMOTE_FILE_TEXT_PAGE_MIN_BYTES,
} from '../../remote/files/values.js';
import { isWellFormedFileText } from '../../remote/files/text-codec.js';
import { AGENT_PLUGIN_MAX_MESSAGE_BYTES } from './values.js';
import type {
	AgentPluginRemoteTextPageRequest,
	AgentPluginRemoteTextPageResult,
	AgentPluginRemoteListPageRequest,
	AgentPluginRemoteListPageResult,
	AgentPluginRemoteListPage,
} from './remote-files.js';

function text(input: unknown): string {
	if (typeof input !== 'string' || !isWellFormedFileText(input) || input.includes('\0')) {
		throw new InvalidAgentPayload();
	}
	return input;
}

function path(input: unknown): string {
	const value = text(input);
	if (
		!value.startsWith('/') ||
		value.split('/').includes('..') ||
		new TextEncoder().encode(value).byteLength > REMOTE_FILE_MAX_PATH_BYTES
	) {
		throw new InvalidAgentPayload();
	}
	return value;
}

function cursor(input: unknown): string {
	const value = text(input);
	if (
		value.includes('/') ||
		value === '.' ||
		value === '..' ||
		new TextEncoder().encode(value).byteLength > REMOTE_FILE_MAX_PATH_BYTES
	) {
		throw new InvalidAgentPayload();
	}
	return value;
}

function hash(input: unknown): string {
	if (typeof input !== 'string' || !/^[a-f0-9]{64}$/u.test(input)) {
		throw new InvalidAgentPayload();
	}
	return input;
}

export function readAgentPluginRemoteTextPageRequest(input: unknown): AgentPluginRemoteTextPageRequest {
	const row = agentRecord(input, ['connectionId', 'path', 'offset', 'maxBytes'], AGENT_PLUGIN_MAX_MESSAGE_BYTES);
	return {
		connectionId: agentInteger(row.connectionId, 1),
		path: path(row.path),
		offset: agentInteger(row.offset),
		maxBytes: agentInteger(row.maxBytes, REMOTE_FILE_TEXT_PAGE_MIN_BYTES, REMOTE_FILE_TEXT_PAGE_MAX_BYTES),
	};
}

export function readAgentPluginRemoteListPageRequest(input: unknown): AgentPluginRemoteListPageRequest {
	const row = agentRecord(input, ['connectionId', 'path', 'after'], AGENT_PLUGIN_MAX_MESSAGE_BYTES);
	return { connectionId: agentInteger(row.connectionId, 1), path: path(row.path), after: cursor(row.after) };
}

export function readAgentPluginRemoteTextPageResult(
	input: unknown,
	request: AgentPluginRemoteTextPageRequest,
): AgentPluginRemoteTextPageResult {
	const row = agentRecord(
		input,
		input !== null && typeof input === 'object' && 'status' in input && input.status === 'ok'
			? ['status', 'value']
			: ['status'],
		AGENT_PLUGIN_MAX_MESSAGE_BYTES,
	);
	if (row.status === 'not_found' || row.status === 'not_text') {
		return { status: row.status };
	}
	if (row.status !== 'ok') {
		throw new InvalidAgentPayload();
	}
	const page = agentRecord(
		row.value,
		['path', 'text', 'bytes', 'sizeBytes', 'offset', 'nextOffset', 'sha256', 'pageSha256', 'fingerprint'],
		AGENT_PLUGIN_MAX_MESSAGE_BYTES,
	);
	const resultPath = path(page.path);
	const valueText = text(page.text);
	const bytes = agentInteger(page.bytes, 0, request.maxBytes);
	const sizeBytes = agentInteger(page.sizeBytes);
	const offset = agentInteger(page.offset, 0, sizeBytes);
	const nextOffset = page.nextOffset === null ? null : agentInteger(page.nextOffset, offset + 1, sizeBytes);
	const sha256 = page.sha256 === null ? null : hash(page.sha256);
	const pageSha256 = hash(page.pageSha256);
	const canonicalPath =
		'/' +
		request.path
			.split('/')
			.filter((part) => part && part !== '.')
			.join('/');
	if (
		resultPath !== canonicalPath ||
		offset !== request.offset ||
		new TextEncoder().encode(valueText).byteLength !== bytes ||
		offset + bytes > sizeBytes ||
		(nextOffset === null
			? offset + bytes !== sizeBytes
			: nextOffset !== offset + bytes || nextOffset >= sizeBytes) ||
		(offset === 0 && nextOffset === null ? sha256 !== pageSha256 : sha256 !== null)
	) {
		throw new InvalidAgentPayload();
	}
	return {
		status: 'ok',
		value: {
			path: resultPath,
			text: valueText,
			bytes,
			sizeBytes,
			offset,
			nextOffset,
			sha256,
			pageSha256,
			fingerprint: hash(page.fingerprint),
		},
	};
}

export function readAgentPluginRemoteListPageResult(
	input: unknown,
	request: AgentPluginRemoteListPageRequest,
): AgentPluginRemoteListPageResult {
	const row = agentRecord(
		input,
		input !== null && typeof input === 'object' && 'status' in input && input.status === 'ok'
			? ['status', 'value']
			: ['status'],
		AGENT_PLUGIN_MAX_MESSAGE_BYTES,
	);
	if (row.status === 'not_found') {
		return { status: 'not_found' };
	}
	if (row.status !== 'ok') {
		throw new InvalidAgentPayload();
	}
	const page = agentRecord(row.value, ['entries', 'nextAfter', 'fingerprint'], AGENT_PLUGIN_MAX_MESSAGE_BYTES);
	if (!Array.isArray(page.entries) || page.entries.length > REMOTE_FILE_MAX_LIST_ENTRIES) {
		throw new InvalidAgentPayload();
	}
	const entries = page.entries.map((input): AgentPluginRemoteListPage['entries'][number] => {
		const entry = agentRecord(input, ['name', 'kind', 'size', 'modifiedAt']);
		const name = cursor(entry.name);
		if (
			!name ||
			name <= request.after ||
			(entry.kind !== 'file' &&
				entry.kind !== 'directory' &&
				entry.kind !== 'symlink' &&
				entry.kind !== 'other') ||
			typeof entry.modifiedAt !== 'number' ||
			!Number.isFinite(entry.modifiedAt)
		) {
			throw new InvalidAgentPayload();
		}
		return { name, kind: entry.kind, size: agentInteger(entry.size), modifiedAt: entry.modifiedAt };
	});
	const nextAfter = page.nextAfter === null ? null : cursor(page.nextAfter);
	if (
		entries.some((entry, index) => index > 0 && entry.name <= entries[index - 1].name) ||
		(nextAfter !== null && (!entries.length || nextAfter !== entries[entries.length - 1].name))
	) {
		throw new InvalidAgentPayload();
	}
	return { status: 'ok', value: { entries, nextAfter, fingerprint: hash(page.fingerprint) } };
}
