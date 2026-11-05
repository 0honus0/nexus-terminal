import { AGENT_ARTIFACT_MAX_BYTES } from '@nexus-terminal/shared/agent/artifacts/values';
import { AGENT_EXECUTION_LIMIT_MAXIMA } from '@nexus-terminal/shared/agent/execution/values';
import { isAgentPluginVersion } from '@nexus-terminal/shared/agent/plugins/values';
import { browserInput } from './browser-input.js';
import { collaborationInput } from './collaboration-tools.js';
import { RESULT_PAGE_MAX_BYTES } from '../../context/result-rules.js';
import { AGENT_ID_PATTERN } from '@nexus-terminal/shared/agent/values';
import { DOCKER_ACTIONS } from '@nexus-terminal/shared/remote/docker/values';
import { posix } from 'node:path';
import { AgentFailure } from '../../agent-failure.js';
import { TOOL_ARGUMENT_MAX_BYTES, TOOL_RESULT_MAX_BYTES } from '../../runs/run-tool-limits.js';
import { isWellFormedFileText } from '@nexus-terminal/shared/remote/files/text-codec';
import type { ToolDeleteItem } from '../model/tool-batch-types.js';
import type { ToolDefinition, ToolInput } from '../model/tool-types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function object(input: string): Record<string, unknown> {
	if (Buffer.byteLength(input, 'utf8') > TOOL_ARGUMENT_MAX_BYTES) {
		throw new AgentFailure('limit_exceeded');
	}
	let value: unknown;
	try {
		value = JSON.parse(input);
	} catch {
		throw new AgentFailure('invalid_input');
	}
	if (!isRecord(value)) {
		throw new AgentFailure('invalid_input');
	}
	return value;
}

function integer(value: unknown, minimum: number, maximum: number): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new AgentFailure('invalid_input');
	}
	return value;
}

function text(value: unknown, maxBytes: number, allowEmpty = false): string {
	if (
		typeof value !== 'string' ||
		(!allowEmpty && !value) ||
		!isWellFormedFileText(value) ||
		value.includes('\0') ||
		Buffer.byteLength(value, 'utf8') > maxBytes
	) {
		throw new AgentFailure('invalid_input');
	}
	return value;
}

function absolutePath(value: unknown, maxBytes: number): string {
	const requested = text(value, maxBytes);
	if (!requested.startsWith('/') || requested.split('/').includes('..')) {
		throw new AgentFailure('invalid_input');
	}
	return posix.resolve(requested);
}

function texts(value: unknown, maxItems: number, maxItemBytes: number): string[] {
	if (!Array.isArray(value) || !value.length || value.length > maxItems) {
		throw new AgentFailure('invalid_input');
	}
	return value.map((item) => text(item, maxItemBytes, true));
}

function validateFields(fields: ToolDefinition['input']['fields'], value: Record<string, unknown>): void {
	if (Object.keys(value).some((key) => !fields.some((field) => field.name === key))) {
		throw new AgentFailure('invalid_input');
	}
	for (const field of fields) {
		if (value[field.name] === undefined && !field.required) {
			continue;
		}
		if (field.kind === 'objects') {
			const items = value[field.name];
			if (!Array.isArray(items) || !items.length || items.length > field.maxItems) {
				throw new AgentFailure('invalid_input');
			}
			for (const item of items) {
				if (!isRecord(item)) {
					throw new AgentFailure('invalid_input');
				}
				validateFields(field.fields, item);
			}
		} else if (field.kind === 'texts') {
			texts(value[field.name], field.maxItems, field.maxItemBytes);
		} else if (field.kind === 'integer') {
			integer(value[field.name], field.minimum, field.maximum);
		} else {
			const entry = text(value[field.name], field.maxBytes, field.allowEmpty);
			if (field.choices !== undefined && !field.choices.includes(entry)) {
				throw new AgentFailure('invalid_input');
			}
		}
	}
}

export function toolInput(definition: ToolDefinition, argumentsJson: string): ToolInput {
	const value = object(argumentsJson);
	validateFields(definition.input.fields, value);
	if (definition.name === 'plugin_tool_call') {
		const name = text(value.name, 64),
			version = text(value.version, 64),
			sha256 = text(value.sha256, 64);
		const argumentsJson = text(value.argumentsJson, 128 * 1024);
		let args: unknown;
		try {
			args = JSON.parse(argumentsJson);
		} catch {
			throw new AgentFailure('invalid_input');
		}
		if (!/^[a-z][a-z0-9_]{0,63}$/u.test(name) || !/^[a-f0-9]{64}$/u.test(sha256) || !isRecord(args)) {
			throw new AgentFailure('invalid_input');
		}
		return { kind: 'plugin', name, version, sha256, argumentsJson };
	}
	if (definition.name === 'image_models_list') {
		return {
			kind: 'image_models',
			offset: value.offset === undefined ? 0 : integer(value.offset, 0, Number.MAX_SAFE_INTEGER - 20),
		};
	}
	if (definition.name === 'image_generate') {
		const providerId = text(value.providerId, 36);
		if (!AGENT_ID_PATTERN.test(providerId)) {
			throw new AgentFailure('invalid_input');
		}
		return {
			kind: 'image_generate',
			input: {
				providerId,
				configurationVersion: integer(value.configurationVersion, 1, Number.MAX_SAFE_INTEGER),
				modelId: text(value.modelId, 512),
				prompt: text(value.prompt, 16000),
			},
		};
	}
	if (definition.name === 'skill_search') {
		const query = text(value.query, 512).trim();
		if (!query) {
			throw new AgentFailure('invalid_input');
		}
		return {
			kind: 'skill',
			input: { action: 'search', query, limit: value.limit === undefined ? 8 : integer(value.limit, 1, 8) },
		};
	}
	if (definition.name === 'skill_read') {
		const name = text(value.name, 64),
			version = text(value.version, 64),
			sha256 = text(value.sha256, 64);
		if (
			!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name) ||
			!isAgentPluginVersion(version) ||
			!/^[a-f0-9]{64}$/u.test(sha256)
		) {
			throw new AgentFailure('invalid_input');
		}
		return { kind: 'skill', input: { action: 'read', name, version, sha256 } };
	}
	if (definition.name === 'browser_targets_list') {
		return { kind: 'browser_targets' };
	}
	if (definition.name === 'acp_integration_list') {
		return { kind: 'acp_integrations' };
	}
	if (definition.name.startsWith('browser_')) {
		return { kind: 'browser', input: browserInput(definition.name, value) };
	}
	if (definition.name === 'acp_integration_execute') {
		const id = text(value.integrationId, 36).toLowerCase();
		if (!AGENT_ID_PATTERN.test(id)) {
			throw new AgentFailure('invalid_input');
		}
		return {
			kind: 'acp_integration',
			input: {
				id,
				version: integer(value.version, 1, Number.MAX_SAFE_INTEGER),
				prompt: text(value.prompt, 8192),
			},
		};
	}
	if (definition.name === 'mcp_discover') {
		if (value.integrationId === undefined && value.version === undefined) {
			return { kind: 'mcp_discovery', input: { id: null, version: null } };
		}
		const id = text(value.integrationId, 36).toLowerCase();
		if (!AGENT_ID_PATTERN.test(id)) {
			throw new AgentFailure('invalid_input');
		}
		return { kind: 'mcp_discovery', input: { id, version: integer(value.version, 1, Number.MAX_SAFE_INTEGER) } };
	}
	if (definition.name === 'mcp_tool' || definition.name === 'mcp_resource' || definition.name === 'mcp_prompt') {
		const id = text(value.integrationId, 36).toLowerCase(),
			schemaHash = text(value.schemaHash, 64),
			argumentsJson = text(value.argumentsJson, 8192);
		if (!AGENT_ID_PATTERN.test(id) || !/^[a-f0-9]{64}$/u.test(schemaHash)) {
			throw new AgentFailure('invalid_input');
		}

		function jsonObject(encoded: string): void {
			let decoded: unknown;
			try {
				decoded = JSON.parse(encoded);
			} catch {
				throw new AgentFailure('invalid_input');
			}
			if (!isRecord(decoded)) {
				throw new AgentFailure('invalid_input');
			}
		}

		jsonObject(argumentsJson);
		const resume =
			value.inputResponsesJson === undefined
				? null
				: {
						requestState: value.requestState === undefined ? null : text(value.requestState, 4096),
						inputResponsesJson: text(value.inputResponsesJson, 4096),
					};
		if (resume) {
			jsonObject(resume.inputResponsesJson);
		} else if (value.requestState !== undefined) {
			throw new AgentFailure('invalid_input');
		}
		return {
			kind: 'mcp',
			input: {
				id,
				version: integer(value.version, 1, Number.MAX_SAFE_INTEGER),
				schemaHash,
				kind:
					definition.name === 'mcp_tool'
						? 'tool'
						: definition.name === 'mcp_resource'
							? 'resource'
							: 'prompt',
				name: text(value.name, 1024),
				argumentsJson,
				resume,
			},
		};
	}
	if (definition.name === 'host_diagnostics_read') {
		return { kind: 'host_diagnostics' };
	}
	if (definition.name === 'context_checkpoint') {
		return { kind: 'checkpoint', summary: text(value.summary, 16384) };
	}
	if (definition.name === 'artifact_create') {
		return {
			kind: 'artifact',
			action: 'create',
			name: text(value.name, 256),
			content: text(value.content, 16384, true),
		};
	}

	if (definition.name === 'artifact_present') {
		const artifactIds = texts(value.artifactIds, Number.MAX_SAFE_INTEGER, 36);
		if (new Set(artifactIds).size !== artifactIds.length || artifactIds.some((id) => !AGENT_ID_PATTERN.test(id))) {
			throw new AgentFailure('invalid_input');
		}
		return { kind: 'artifact', action: 'present', artifactIds };
	}
	if (definition.name === 'artifact_read') {
		const artifactId = text(value.artifactId, 36);
		if (!AGENT_ID_PATTERN.test(artifactId)) {
			throw new AgentFailure('invalid_input');
		}
		return {
			kind: 'artifact',
			action: 'read',
			artifactId,
			offset: value.offset === undefined ? 0 : integer(value.offset, 0, AGENT_ARTIFACT_MAX_BYTES),
			maxBytes:
				value.maxBytes === undefined ? 4096 : integer(value.maxBytes, value.encoding === 'utf8' ? 4 : 1, 4096),
			encoding: value.encoding === 'utf8' ? 'utf8' : 'base64',
		};
	}
	if (definition.name === 'memory_propose') {
		return { kind: 'memory', action: 'propose', content: text(value.content, 16384) };
	}
	if (definition.name === 'memory_recall') {
		return {
			kind: 'memory',
			action: 'recall',
			query: text(value.query, 4096),
			limit:
				value.limit === undefined ? 10 : integer(value.limit, 1, AGENT_EXECUTION_LIMIT_MAXIMA.maxRecallItems),
		};
	}
	if (definition.name.startsWith('collaboration_')) {
		return { kind: 'collaboration', input: collaborationInput(definition.name, value) };
	}
	if (definition.name === 'machine_connection_list') {
		return { kind: 'connections' };
	}
	if (definition.name === 'tool_result_read') {
		if (!Array.isArray(value.items) || !value.items.length) {
			throw new AgentFailure('invalid_input');
		}
		const items = value.items.map((item) => {
			if (!isRecord(item)) {
				throw new AgentFailure('invalid_input');
			}
			const toolCallId = text(item.toolCallId, 36),
				sha256 = text(item.sha256, 64);
			if (!AGENT_ID_PATTERN.test(toolCallId) || !/^[a-f0-9]{64}$/u.test(sha256)) {
				throw new AgentFailure('invalid_input');
			}
			return {
				toolCallId,
				sha256,
				offset: item.offset === undefined ? 0 : integer(item.offset, 0, TOOL_RESULT_MAX_BYTES),
				maxBytes:
					item.maxBytes === undefined
						? RESULT_PAGE_MAX_BYTES
						: integer(item.maxBytes, 8, RESULT_PAGE_MAX_BYTES),
			};
		});
		return { kind: 'result', items };
	}

	const connectionId = integer(value.connectionId, 1, Number.MAX_SAFE_INTEGER);
	if (definition.name === 'project_directory_bind') {
		return {
			kind: 'project',
			connectionId,
			input: { action: 'bind', directory: absolutePath(value.directory, 256) },
		};
	}
	if (definition.name === 'project_directory_read') {
		return {
			kind: 'project',
			connectionId,
			input: { action: 'read', path: value.path === undefined ? null : absolutePath(value.path, 256) },
		};
	}
	if (definition.name === 'project_directory_clear') {
		return { kind: 'project', connectionId, input: { action: 'clear' } };
	}
	if (definition.name === 'machine_diagnostics_read') {
		return { kind: 'diagnostics', connectionId };
	}

	if (definition.name === 'acp_execute') {
		const argv = texts(value.argv, 128, 8192);
		const cwd = absolutePath(value.cwd, 256);
		const prompt = text(value.prompt, 8192);
		if (
			!argv[0] ||
			argv[0].startsWith('-') ||
			argv.reduce((sum, arg) => sum + Buffer.byteLength(arg, 'utf8'), 0) > 8192 ||
			/[\u0000-\u001f\u007f]/u.test(cwd) ||
			!prompt.trim()
		) {
			throw new AgentFailure('invalid_input');
		}
		return { kind: 'acp', connectionId, argv, cwd, prompt };
	}
	if (definition.name === 'shell_execute') {
		const cwd = value.cwd === undefined ? null : absolutePath(value.cwd, 256);
		if (cwd !== null && /[\u0000-\u001f\u007f]/u.test(cwd)) {
			throw new AgentFailure('invalid_input');
		}
		const mode = value.mode === undefined ? 'foreground' : value.mode;
		if (mode !== 'foreground' && mode !== 'background') {
			throw new AgentFailure('invalid_input');
		}
		const yieldSeconds =
			value.yieldSeconds === undefined
				? null
				: integer(value.yieldSeconds, 0, AGENT_EXECUTION_LIMIT_MAXIMA.toolTimeoutSeconds);
		if (mode === 'background' && yieldSeconds !== null) {
			throw new AgentFailure('invalid_input');
		}
		const commands = texts(value.commands, Number.MAX_SAFE_INTEGER, 8192);
		if (commands.some((command) => !command.trim())) {
			throw new AgentFailure('invalid_input');
		}
		const onError = value.onError ?? 'stop';
		if (onError !== 'stop' && onError !== 'continue') {
			throw new AgentFailure('invalid_input');
		}
		// Reserve the existing durable result budget before dispatch, including worst-case JSON escaping.
		const metadataBytes = Buffer.byteLength(
			JSON.stringify(
				commands.map((_, index) => ({
					index,
					status: 'nonzero',
					exitCode: 255,
					signal: null,
					stdout: '',
					stderr: '',
					truncated: true,
				})),
			),
		);
		if (metadataBytes + 32 * 1024 * 6 + 128 > TOOL_RESULT_MAX_BYTES) {
			throw new AgentFailure('limit_exceeded');
		}
		return { kind: 'shell', connectionId, commands, onError, cwd, mode, yieldSeconds };
	}
	if (definition.name === 'shell_job_control') {
		const action = value.action;
		if (
			action !== 'list' &&
			action !== 'status' &&
			action !== 'wait' &&
			action !== 'cancel' &&
			action !== 'output'
		) {
			throw new AgentFailure('invalid_input');
		}
		if (
			(action === 'list' && value.jobIds !== undefined) ||
			(action !== 'wait' && (value.waitSeconds !== undefined || value.waitMode !== undefined)) ||
			(action !== 'list' && action !== 'output' && value.offset !== undefined)
		) {
			throw new AgentFailure('invalid_input');
		}
		const jobIds = action === 'list' ? [] : texts(value.jobIds, Number.MAX_SAFE_INTEGER, 36);
		if (new Set(jobIds).size !== jobIds.length || jobIds.some((id) => !AGENT_ID_PATTERN.test(id))) {
			throw new AgentFailure('invalid_input');
		}
		return {
			kind: 'job',
			connectionId,
			action,
			jobIds,
			waitMode: value.waitMode === 'any' ? 'any' : 'all',
			waitSeconds:
				action === 'wait' ? (value.waitSeconds === undefined ? 10 : integer(value.waitSeconds, 1, 30)) : 0,
			offset:
				(action === 'list' || action === 'output') && value.offset !== undefined
					? integer(value.offset, 0, Number.MAX_SAFE_INTEGER - 64)
					: 0,
		};
	}
	if (definition.name === 'machine_docker_inspect') {
		const containerIds = texts(value.containerIds, Number.MAX_SAFE_INTEGER, 64);
		if (
			new Set(containerIds).size !== containerIds.length ||
			containerIds.some((id) => !/^[a-f0-9]{64}$/.test(id))
		) {
			throw new AgentFailure('invalid_input');
		}
		return { kind: 'docker_inspect', connectionId, containerIds };
	}
	if (['file_write', 'file_move', 'file_delete', 'machine_docker_control'].includes(definition.name)) {
		const onError = value.onError ?? 'stop';
		if (onError !== 'stop' && onError !== 'continue') {
			throw new AgentFailure('invalid_input');
		}
		const items = value.items;
		if (!Array.isArray(items) || !items.length || items.some((item) => !isRecord(item))) {
			throw new AgentFailure('invalid_input');
		}
		const records = items.filter(isRecord);
		if (definition.name === 'machine_docker_control') {
			const operations = records.map((item) => {
				const containerId = text(item.containerId, 64),
					expectedFingerprint = text(item.expectedFingerprint, 64);
				const action = DOCKER_ACTIONS.find((candidate) => candidate === item.action);
				if (!action || !/^[a-f0-9]{64}$/.test(containerId) || !/^[a-f0-9]{64}$/.test(expectedFingerprint)) {
					throw new AgentFailure('invalid_input');
				}
				return { containerId, expectedFingerprint, action };
			});
			if (new Set(operations.map((item) => item.containerId)).size !== operations.length) {
				throw new AgentFailure('invalid_input');
			}
			return { kind: 'docker_control', connectionId, items: operations, onError };
		}

		const pathFor = (item: Record<string, unknown>) => {
			const path = absolutePath(item.path, 256);
			if (path === '/' || /[\u0000-\u001f\u007f]/u.test(path)) {
				throw new AgentFailure('invalid_input');
			}
			return path;
		};

		const hashFor = (item: Record<string, unknown>) => {
			const hash = text(item.expectedFingerprint, 64);
			if (!/^[a-f0-9]{64}$/.test(hash)) {
				throw new AgentFailure('invalid_input');
			}
			return hash;
		};

		const paths: string[] = [];

		const addPath = (path: string) => {
			if (paths.some((other) => path === other || path.startsWith(other + '/') || other.startsWith(path + '/'))) {
				throw new AgentFailure('invalid_input');
			}
			paths.push(path);
		};

		if (definition.name === 'file_write') {
			const operations = records.map((item) => {
				const path = pathFor(item);
				addPath(path);
				const expectedSha256 = text(item.expectedSha256, 64);
				if (expectedSha256 !== 'absent' && !/^[a-f0-9]{64}$/.test(expectedSha256)) {
					throw new AgentFailure('invalid_input');
				}
				return { path, content: text(item.content, 8192, true), expectedSha256 };
			});
			return { kind: 'write', connectionId, items: operations, onError };
		}
		if (definition.name === 'file_move') {
			const operations = records.map((item) => {
				const path = pathFor(item),
					destinationPath = absolutePath(item.destinationPath, 256);
				if (destinationPath === '/' || /[\u0000-\u001f\u007f]/u.test(destinationPath)) {
					throw new AgentFailure('invalid_input');
				}
				addPath(path);
				addPath(destinationPath);
				return { path, destinationPath, expectedFingerprint: hashFor(item) };
			});
			return { kind: 'move', connectionId, items: operations, onError };
		}
		const operations: ToolDeleteItem[] = records.map((item): ToolDeleteItem => {
			const path = pathFor(item);
			addPath(path);
			const scope = item.scope;
			if (scope !== 'entry' && scope !== 'tree') {
				throw new AgentFailure('invalid_input');
			}
			return { path, expectedFingerprint: hashFor(item), scope };
		});
		return { kind: 'delete', connectionId, items: operations, onError };
	}
	if (definition.name === 'file_read' || definition.name === 'file_list' || definition.name === 'file_inspect') {
		const paths = texts(value.paths, Number.MAX_SAFE_INTEGER, definition.name === 'file_inspect' ? 256 : 4096).map(
			(item) => absolutePath(item, 4096),
		);
		if (new Set(paths).size !== paths.length) {
			throw new AgentFailure('invalid_input');
		}
		if (definition.name === 'file_read') {
			return {
				kind: 'read',
				connectionId,
				paths,
				offset: value.offset === undefined ? 0 : integer(value.offset, 0, Number.MAX_SAFE_INTEGER),
				maxBytes: value.maxBytes === undefined ? 32768 : integer(value.maxBytes, 4, 32768),
			};
		}
		if (definition.name === 'file_list') {
			return {
				kind: 'list',
				connectionId,
				paths,
				after: value.after === undefined ? '' : text(value.after, 4096, true),
			};
		}
		return { kind: 'inspect', connectionId, paths };
	}
	if (definition.name === 'file_deliver') {
		const paths = texts(value.paths, Number.MAX_SAFE_INTEGER, 4096).map((item) => absolutePath(item, 4096));
		if (
			new Set(paths).size !== paths.length ||
			paths.some((path) => path === '/' || /[\u0000-\u001f\u007f]/u.test(path))
		) {
			throw new AgentFailure('invalid_input');
		}
		return { kind: 'deliver', connectionId, paths };
	}

	const path = absolutePath(value.path, 4096);
	if (definition.mutation && (/[\u0000-\u001f\u007f]/u.test(path) || path === '/')) {
		throw new AgentFailure('invalid_input');
	}

	if (definition.name === 'file_patch') {
		const expectedSha256 = text(value.expectedSha256, 64);
		if (!/^[a-f0-9]{64}$/.test(expectedSha256) || !Array.isArray(value.edits) || !value.edits.length) {
			throw new AgentFailure('invalid_input');
		}
		const edits = value.edits.map((item) => {
			if (!isRecord(item)) {
				throw new AgentFailure('invalid_input');
			}
			const oldText = text(item.oldText, 4096),
				newText = text(item.newText, 4096, true);
			if (oldText === newText) {
				throw new AgentFailure('invalid_input');
			}
			return { oldText, newText };
		});
		return { kind: 'patch', connectionId, path, expectedSha256, edits };
	}
	if (definition.name !== 'file_search') {
		throw new AgentFailure('invalid_input');
	}
	const queries = texts(value.queries, Number.MAX_SAFE_INTEGER, 1024);
	if (
		new Set(queries).size !== queries.length ||
		queries.some((query) => !query || query.includes('\n') || query.includes('\r'))
	) {
		throw new AgentFailure('invalid_input');
	}
	return {
		kind: 'search',
		connectionId,
		path,
		queries,
		maxResults: value.maxResults === undefined ? 20 : integer(value.maxResults, 1, 100),
	};
}
