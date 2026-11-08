import { agentPluginCapabilityReplyBytes } from './runtime-codec.js';
import { encodeAgentJson, InvalidAgentPayload } from '../http-codec.js';
import {
	AGENT_PLUGIN_MAX_MESSAGE_BYTES,
	AGENT_PLUGIN_HOST_ARGUMENT_MAX_BYTES,
	AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES,
} from './values.js';
import type { AgentPluginHostOperationName } from './values.js';
import { agentPluginHostOperationRequestSchema, agentPluginHostOperationResultSchema } from './host-operations.js';
import type { AgentPluginHostOperationRequest, AgentPluginHostOperationResult } from './host-operations.js';
import { readAgentPluginRemoteTextPageResult, readAgentPluginRemoteListPageResult } from './remote-files-codec.js';

function valid(condition: boolean): void {
	if (!condition) {
		throw new InvalidAgentPayload();
	}
}

function distinct(values: readonly (string | number)[]): boolean {
	return new Set(values).size === values.length;
}

function byteLength(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

function canonicalPath(value: string): string {
	return (
		'/' +
		value
			.split('/')
			.filter((part) => part && part !== '.')
			.join('/')
	);
}

function decodedBase64Length(value: string): number {
	try {
		const decoded = atob(value);
		valid(btoa(decoded) === value);
		return decoded.length;
	} catch {
		throw new InvalidAgentPayload();
	}
}

function readJson(value: string): unknown {
	try {
		const parsed: unknown = JSON.parse(value);
		return parsed;
	} catch {
		throw new InvalidAgentPayload();
	}
}

function checkPage(page: { offset: number; nextOffset: number | null }, sizeBytes: number, bytes: number): void {
	const end = page.offset + bytes;
	valid(
		end <= sizeBytes &&
			(page.nextOffset === null ? end === sizeBytes : page.nextOffset === end && end < sizeBytes && bytes > 0),
	);
}

/** Captured result cursors count Unicode code points; maxBytes bounds the JSON string, including quotes. */
function checkCapturedPage(
	page: { offset: number; nextOffset: number | null; originalBytes: number; text: string },
	maxBytes?: number,
): void {
	const points = Array.from(page.text).length;
	const bytes = byteLength(page.text);
	valid(page.offset + bytes <= page.originalBytes);
	valid(
		page.nextOffset === null ||
			(points > 0 && page.nextOffset === page.offset + points && page.nextOffset < page.originalBytes),
	);
	if (page.offset === 0 && page.nextOffset === null) {
		valid(bytes === page.originalBytes);
	}
	if (maxBytes !== undefined) {
		valid(byteLength(JSON.stringify(page.text)) <= maxBytes);
	}
}

function checkIndexes(items: readonly { index: number }[], length = items.length): void {
	valid(items.length === length && items.every((item, index) => item.index === index));
}

export function readAgentPluginHostOperationRequest(input: unknown): AgentPluginHostOperationRequest {
	encodeAgentJson(input, AGENT_PLUGIN_HOST_ARGUMENT_MAX_BYTES);
	const parsed = agentPluginHostOperationRequestSchema.safeParse(input);
	if (!parsed.success) {
		throw new InvalidAgentPayload();
	}
	const request = parsed.data;
	if (request.operation === 'discovery.catalog') {
		valid((request.cursor === 0) === (request.sha256 === null));
	}
	if (request.operation === 'memory.retrieve' && request.action === 'select') {
		valid(distinct(request.items.map((item) => item.id)));
	}
	if (request.operation === 'collaboration.delegate') {
		readJson(request.inputJson);
	}
	valid(
		!(
			(request.operation === 'artifacts.read' && request.encoding === 'utf8' && request.maxBytes < 4) ||
			(request.operation === 'shell.execute' && request.mode === 'background' && request.yieldSeconds !== null) ||
			(request.operation === 'discovery.activate' && !distinct(request.names)) ||
			(request.operation === 'remote.deliver' && !distinct(request.paths.map(canonicalPath))) ||
			(request.operation === 'remote.search' && !distinct(request.queries)) ||
			(request.operation === 'browser.press' && !distinct(request.modifiers)) ||
			(request.operation === 'collaboration.delegate' &&
				(!distinct(request.targets) || !distinct(request.dependencies))) ||
			((request.operation === 'collaboration.join' || request.operation === 'collaboration.cancel') &&
				!distinct(request.childIds)) ||
			(request.operation === 'shell.jobs' && !distinct(request.jobIds))
		),
	);
	if (request.operation === 'artifacts.create') {
		decodedBase64Length(request.base64);
	}
	if (request.operation === 'shell.jobs') {
		valid(request.action === 'list' ? request.jobIds.length === 0 : request.jobIds.length > 0);
		valid(request.action === 'wait' || (request.waitSeconds === 0 && request.waitMode === 'all'));
		valid(request.action === 'list' || request.action === 'output' || request.offset === 0);
	}
	if (request.operation === 'remote.write' || request.operation === 'remote.delete') {
		valid(distinct(request.items.map((item) => canonicalPath(item.path))));
	}
	if (request.operation === 'remote.move') {
		const paths = request.items.flatMap((item) => [canonicalPath(item.path), canonicalPath(item.destinationPath)]);
		valid(distinct(paths));
	}
	if (request.operation === 'docker.control') {
		valid(distinct(request.items.map((item) => item.containerId)));
	}
	if (request.operation === 'collaboration.consumeMessages') {
		valid(request.through >= request.expectedConsumed);
	}
	return request;
}

export function readAgentPluginHostOperationRequestFor(
	operation: AgentPluginHostOperationName,
	input: unknown,
): AgentPluginHostOperationRequest {
	const request = readAgentPluginHostOperationRequest(input);
	valid(request.operation === operation);
	return request;
}

/** Decode domain data only. Authority, targets, activated tools and artifacts are supplied by the Host closure. */
export function readAgentPluginHostOperationResult(
	input: unknown,
	request?: AgentPluginHostOperationRequest,
): AgentPluginHostOperationResult {
	encodeAgentJson(input, AGENT_PLUGIN_MAX_MESSAGE_BYTES);
	const parsed = agentPluginHostOperationResultSchema.safeParse(input);
	if (!parsed.success) {
		throw new InvalidAgentPayload();
	}
	const result = parsed.data;
	valid(request === undefined || result.operation === request.operation);
	if (result.operation === 'discovery.catalog') {
		valid(distinct(result.value.definitions.map((item) => item.name)));
		if (request?.operation === result.operation) {
			valid(request.sha256 === null || request.sha256 === result.value.sha256);
			valid(
				result.value.nextCursor === null ||
					(result.value.definitions.length > 0 &&
						result.value.nextCursor === request.cursor + result.value.definitions.length),
			);
		}
	}
	if (result.operation === 'discovery.activate') {
		valid(distinct(result.value.names));
		if (request?.operation === result.operation) {
			const positions = result.value.names.map((name) => request.names.indexOf(name));
			valid(
				positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1])),
			);
		}
	}
	if (result.operation === 'targets.list') {
		valid(distinct(result.value.connections.map((item) => item.id)));
	}
	if (result.operation === 'images.list') {
		valid(
			distinct(
				result.value.models.map((item) =>
					JSON.stringify([item.providerId, item.configurationVersion, item.modelId]),
				),
			),
		);
	}
	if (result.operation === 'skills.catalog') {
		valid(agentPluginCapabilityReplyBytes(result) <= AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES);
		if (request?.operation === result.operation) {
			valid(
				result.value.nextOffset === null ||
					(result.value.items.length > 0 &&
						result.value.nextOffset === request.offset + result.value.items.length),
			);
		}
	}
	if (result.operation === 'memory.retrieve') {
		valid(distinct(result.value.items.map((item) => item.id)));
		if (result.value.action === 'candidates') {
			valid(agentPluginCapabilityReplyBytes(result) <= AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES);
		}
		if (request?.operation === result.operation) {
			valid(result.value.action === request.action);
			if (request.action === 'candidates' && result.value.action === 'candidates') {
				valid(
					result.value.maxItems <= request.limit &&
						(result.value.nextOffset === null ||
							(result.value.items.length > 0 &&
								result.value.nextOffset === request.offset + result.value.items.length)),
				);
			}
			if (request.action === 'select' && result.value.action === 'select') {
				valid(
					result.value.items.length === request.items.length &&
						result.value.items.every((item, index) => {
							const selected = request.items[index];
							return (
								selected !== undefined &&
								item.id === selected.id &&
								item.version === selected.version &&
								item.score === selected.score
							);
						}),
				);
			}
		}
	}
	if (result.operation === 'skills.read' && request?.operation === result.operation) {
		valid(
			result.value.name === request.name &&
				result.value.version === request.version &&
				result.value.sha256 === request.sha256,
		);
	}
	if (result.operation === 'context.readResults') {
		checkCapturedPage(result.value);
		if (request?.operation === result.operation) {
			valid(
				result.value.toolCallId === request.item.toolCallId &&
					result.value.sha256 === request.item.sha256 &&
					result.value.offset === request.item.offset &&
					byteLength(JSON.stringify(result.value.text)) <= request.item.maxBytes,
			);
		}
	}
	if (result.operation === 'artifacts.read') {
		const value = result.value;
		valid(
			value.encoding === 'base64'
				? value.base64 !== null && value.text === null
				: value.text !== null && value.base64 === null,
		);
		const bytes =
			value.base64 !== null
				? decodedBase64Length(value.base64)
				: value.text !== null
					? byteLength(value.text)
					: 0;
		checkPage(value, value.sizeBytes, bytes);
		if (request?.operation === result.operation) {
			valid(
				value.id === request.artifactId &&
					value.offset === request.offset &&
					value.encoding === request.encoding &&
					bytes <= request.maxBytes,
			);
		}
	}
	if (result.operation === 'artifacts.present' && request?.operation === result.operation) {
		valid(result.value.id === request.artifactId);
	}
	if (
		(result.operation === 'project.bindingRead' || result.operation === 'project.bindingWrite') &&
		(request?.operation === 'project.bindingRead' || request?.operation === 'project.bindingWrite')
	) {
		valid(result.value.binding === null || result.value.binding.connectionId === request.connectionId);
		if (request.operation === 'project.bindingWrite') {
			valid(
				request.directory === null
					? result.value.binding === null
					: result.value.binding?.directory === canonicalPath(request.directory),
			);
		}
	}
	if (result.operation === 'remote.readTextPage' && request?.operation === result.operation) {
		readAgentPluginRemoteTextPageResult(result.value, request);
	}
	if (result.operation === 'remote.listPage' && request?.operation === result.operation) {
		readAgentPluginRemoteListPageResult(result.value, request);
	}
	if (
		result.operation === 'remote.inspect' &&
		request?.operation === result.operation &&
		result.value.status === 'ok'
	) {
		valid(result.value.value.path === canonicalPath(request.path));
	}
	if (
		result.operation === 'docker.inspect' &&
		request?.operation === result.operation &&
		result.value.status === 'ok'
	) {
		valid(result.value.value.containerId === request.containerId);
	}
	if (result.operation === 'remote.search' && request?.operation === result.operation) {
		valid(
			result.value.matches.length <= request.maxResults &&
				result.value.matches.every((item) => item.queryIndex < request.queries.length),
		);
	}
	if (
		result.operation === 'remote.write' ||
		result.operation === 'remote.move' ||
		result.operation === 'remote.delete' ||
		result.operation === 'remote.deliver' ||
		result.operation === 'docker.control'
	) {
		checkIndexes(result.value.items);
	}
	if (result.operation === 'remote.write' && request?.operation === result.operation) {
		checkIndexes(result.value.items, request.items.length);
		valid(
			result.value.items.every(
				(item, index) =>
					item.status !== 'completed' ||
					(item.value.path === canonicalPath(request.items[index].path) &&
						item.value.bytes === byteLength(request.items[index].content)),
			),
		);
	}
	if (result.operation === 'remote.move' && request?.operation === result.operation) {
		checkIndexes(result.value.items, request.items.length);
		valid(
			result.value.items.every(
				(item, index) =>
					item.status !== 'completed' ||
					(item.value.path === canonicalPath(request.items[index].path) &&
						item.value.destinationPath === canonicalPath(request.items[index].destinationPath)),
			),
		);
	}
	if (result.operation === 'remote.delete' && request?.operation === result.operation) {
		checkIndexes(result.value.items, request.items.length);
		valid(
			result.value.items.every(
				(item, index) =>
					item.status !== 'completed' || item.value.path === canonicalPath(request.items[index].path),
			),
		);
	}
	if (result.operation === 'docker.control' && request?.operation === result.operation) {
		checkIndexes(result.value.items, request.items.length);
		valid(
			result.value.items.every(
				(item, index) =>
					item.status !== 'completed' ||
					(item.value.containerId === request.items[index].containerId &&
						item.value.action === request.items[index].action),
			),
		);
	}
	if (result.operation === 'remote.deliver' && request?.operation === result.operation) {
		checkIndexes(result.value.items, request.paths.length);
	}
	if (result.operation === 'remote.patch' && request?.operation === result.operation) {
		valid(result.value.path === canonicalPath(request.path));
	}
	if (result.operation === 'shell.execute' || result.operation === 'shell.jobs') {
		const value = result.value;
		if ('state' in value) {
			valid(value.updatedAt >= value.createdAt);
			if (value.result !== null && 'commands' in value.result) {
				checkIndexes(value.result.commands);
				if (request?.operation === 'shell.execute') {
					checkIndexes(value.result.commands, request.commands.length);
				}
			}
		}
		if ('jobs' in value) {
			valid(distinct(value.jobs.map((job) => job.jobId)));
			for (const job of value.jobs) {
				if ('updatedAt' in job) {
					valid(job.updatedAt >= job.createdAt);
				}
				if ('result' in job && job.result !== null && 'commands' in job.result) {
					checkIndexes(job.result.commands);
				}
				if ('output' in job) {
					valid(
						job.nextOffset ===
							job.offset + job.output.reduce((bytes, event) => bytes + byteLength(event.text), 0),
					);
				}
			}
		}
		if (request?.operation === 'shell.jobs') {
			if (!('jobs' in value)) {
				throw new InvalidAgentPayload();
			}
			if (request.action === 'list') {
				valid('nextOffset' in value && (value.nextOffset === null || value.nextOffset > request.offset));
			} else if (request.action === 'output') {
				valid('nextIndex' in value);
				if (!('nextIndex' in value)) {
					throw new InvalidAgentPayload();
				}
				valid(
					value.jobs.length <= request.jobIds.length &&
						value.jobs.every(
							(job, index) => job.jobId === request.jobIds[index] && job.offset === request.offset,
						),
				);
				valid(value.nextIndex === (value.jobs.length < request.jobIds.length ? value.jobs.length : null));
			} else {
				valid(
					!('nextOffset' in value) &&
						!('nextIndex' in value) &&
						value.jobs.length === request.jobIds.length &&
						value.jobs.every((job, index) => job.jobId === request.jobIds[index] && 'result' in job),
				);
			}
		}
		if (request?.operation === 'shell.execute') {
			valid(!('jobs' in value) && (request.mode !== 'background' || 'accepted' in value));
		}
	}
	if (result.operation === 'browser.catalog') {
		valid(distinct(result.value.targets.map((item) => item.targetId)));
	}
	if (result.operation === 'browser.open' && request?.operation === result.operation) {
		valid(result.value.targetId === request.targetId && result.value.targetVersion === request.expectedVersion);
	}
	if (result.operation === 'browser.snapshot') {
		const nodes = result.value.nodes;
		valid(distinct(nodes.map((node) => node.ref)));
		const preceding = new Set<string>();
		for (const node of nodes) {
			valid(
				node.ref.length > 0 &&
					(node.parentRef === null || preceding.has(node.parentRef)) &&
					distinct(node.attributes.map((attribute) => attribute.name)),
			);
			preceding.add(node.ref);
		}
		if (request?.operation === result.operation) {
			valid(nodes.length <= request.maxNodes);
		}
	}
	if (result.operation === 'browser.console') {
		const entries = result.value.entries;
		valid(entries.every((entry, index) => index === 0 || entry.sequence > entries[index - 1].sequence));
		valid(entries.length === 0 || result.value.nextCursor === entries[entries.length - 1].sequence);
		if (request?.operation === result.operation) {
			valid(
				entries.length <= request.limit &&
					entries.every((entry) => entry.sequence > request.after) &&
					result.value.nextCursor >= request.after,
			);
		}
	}
	if (result.operation === 'browser.download' && request?.operation === result.operation) {
		valid(result.value.sizeBytes <= request.maxBytes);
	}
	if (
		result.operation === 'collaboration.list' ||
		result.operation === 'collaboration.join' ||
		result.operation === 'collaboration.cancel'
	) {
		valid(distinct(result.value.children.map((item) => item.id)));
	}
	if (result.operation === 'collaboration.delegate' && request?.operation === result.operation) {
		valid(result.value.profile === request.profile);
	}
	if (result.operation === 'collaboration.list' && request?.operation === result.operation) {
		valid(
			result.value.children.length <= request.limit &&
				result.value.children.every((child) => child.id !== request.after) &&
				(result.value.nextCursor === null ||
					result.value.nextCursor === result.value.children[result.value.children.length - 1]?.id),
		);
	}
	if (
		(result.operation === 'collaboration.join' || result.operation === 'collaboration.cancel') &&
		(request?.operation === 'collaboration.join' || request?.operation === 'collaboration.cancel')
	) {
		valid(
			result.value.children.length === request.childIds.length &&
				result.value.children.every((child) => request.childIds.includes(child.id)),
		);
	}
	if (result.operation === 'collaboration.readOutput') {
		checkCapturedPage(result.value);
		if (request?.operation === result.operation) {
			valid(
				result.value.childId === request.childId &&
					result.value.offset === request.offset &&
					byteLength(JSON.stringify(result.value.text)) <= request.maxBytes,
			);
		}
	}
	if (result.operation === 'collaboration.readMessages') {
		const messages = result.value.messages;
		valid(messages.every((message, index) => index === 0 || message.sequence > messages[index - 1].sequence));
		valid(messages.length === 0 || result.value.nextCursor >= messages[messages.length - 1].sequence);
		if (request?.operation === result.operation) {
			valid(
				messages.length <= request.limit &&
					messages.every((message) => message.sequence > request.after) &&
					result.value.nextCursor >= request.after,
			);
		}
	}
	if (result.operation === 'collaboration.consumeMessages' && request?.operation === result.operation) {
		valid(result.value.consumedThrough === request.through);
	}
	if (
		(result.operation === 'collaboration.readFact' || result.operation === 'collaboration.writeFact') &&
		(request?.operation === 'collaboration.readFact' || request?.operation === 'collaboration.writeFact')
	) {
		valid(result.value.fact === null || result.value.fact.key === request.key);
		if (request.operation === 'collaboration.writeFact') {
			valid(
				result.value.fact !== null &&
					result.value.fact.value === request.value &&
					result.value.fact.version === request.expectedVersion + 1,
			);
		}
	}
	return result;
}
