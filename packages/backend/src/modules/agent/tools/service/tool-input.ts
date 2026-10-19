import { AGENT_PLUGIN_VERSION_PATTERN } from '@nexus-terminal/shared/agent/plugins/values';
import { browserInput } from './browser-input.js';
import { collaborationInput } from './collaboration-tools.js';
import { RESULT_PAGE_MAX_BYTES } from '../../context/result-rules.js';
import { AGENT_ID_PATTERN } from '@nexus-terminal/shared/agent/values';
import { DOCKER_ACTIONS } from '@nexus-terminal/shared/remote/docker/values';
import { posix } from 'node:path';
import { AgentFailure } from '../../agent-failure.js';
import { TOOL_ARGUMENT_MAX_BYTES, TOOL_RESULT_MAX_BYTES } from '../../runs/run-tool-limits.js';
import { isWellFormedFileText } from '@nexus-terminal/shared/remote/files/text-codec';
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

export function toolInput(definition: ToolDefinition, argumentsJson: string): ToolInput {
	const value = object(argumentsJson);
	if (Object.keys(value).some((key) => !definition.input.fields.some((field) => field.name === key))) {
		throw new AgentFailure('invalid_input');
	}
	for (const field of definition.input.fields) {
		if (value[field.name] === undefined && !field.required) {
			continue;
		}
		if (field.kind === 'texts') {
			texts(value[field.name], field.maxItems, field.maxItemBytes);
		} else if (field.kind === 'integer') {
			integer(value[field.name], field.minimum, field.maximum);
		} else {
			text(value[field.name], field.maxBytes, field.allowEmpty);
		}
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
			!AGENT_PLUGIN_VERSION_PATTERN.test(version) ||
			!/^[a-f0-9]{64}$/u.test(sha256)
		) {
			throw new AgentFailure('invalid_input');
		}
		return { kind: 'skill', input: { action: 'read', name, version, sha256 } };
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
	if (definition.name === 'artifact_read') {
		const artifactId = text(value.artifactId, 36);
		if (!AGENT_ID_PATTERN.test(artifactId)) {
			throw new AgentFailure('invalid_input');
		}
		return {
			kind: 'artifact',
			action: 'read',
			artifactId,
			offset: value.offset === undefined ? 0 : integer(value.offset, 0, 16777216),
			maxBytes: value.maxBytes === undefined ? 4096 : integer(value.maxBytes, 1, 4096),
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
			limit: value.limit === undefined ? 10 : integer(value.limit, 1, 20),
		};
	}
	if (definition.name.startsWith('collaboration_')) {
		return { kind: 'collaboration', input: collaborationInput(definition.name, value) };
	}
	if (definition.name === 'machine_connection_list') {
		return { kind: 'connections' };
	}
	if (definition.name === 'tool_result_read') {
		const toolCallId = text(value.toolCallId, 36);
		const sha256 = text(value.sha256, 64);
		if (!AGENT_ID_PATTERN.test(toolCallId) || !/^[a-f0-9]{64}$/u.test(sha256)) {
			throw new AgentFailure('invalid_input');
		}
		return {
			kind: 'result',
			input: {
				toolCallId,
				sha256,
				offset: value.offset === undefined ? 0 : integer(value.offset, 0, TOOL_RESULT_MAX_BYTES),
				maxBytes:
					value.maxBytes === undefined
						? RESULT_PAGE_MAX_BYTES
						: integer(value.maxBytes, 8, RESULT_PAGE_MAX_BYTES),
			},
		};
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
		if (value.kind === 'argv') {
			if (value.script !== undefined) {
				throw new AgentFailure('invalid_input');
			}
			const argv = texts(value.argv, 128, 8192);
			if (
				!argv[0] ||
				argv[0].startsWith('-') ||
				argv.reduce((sum, arg) => sum + Buffer.byteLength(arg, 'utf8'), 0) > 8192
			) {
				throw new AgentFailure('invalid_input');
			}
			return { kind: 'shell', connectionId, command: { kind: 'argv', argv }, cwd, mode };
		}
		if (value.kind !== 'shell' || value.argv !== undefined) {
			throw new AgentFailure('invalid_input');
		}
		return { kind: 'shell', connectionId, command: { kind: 'shell', script: text(value.script, 8192) }, cwd, mode };
	}
	if (definition.name === 'shell_job_control') {
		const action = value.action;
		if (action !== 'list' && action !== 'status' && action !== 'wait' && action !== 'cancel') {
			throw new AgentFailure('invalid_input');
		}
		if (
			(action === 'list' && value.jobId !== undefined) ||
			(action !== 'wait' && value.waitSeconds !== undefined)
		) {
			throw new AgentFailure('invalid_input');
		}
		const jobId = action === 'list' ? null : text(value.jobId, 36);
		if (jobId !== null && !AGENT_ID_PATTERN.test(jobId)) {
			throw new AgentFailure('invalid_input');
		}
		return {
			kind: 'job',
			connectionId,
			action,
			jobId,
			waitSeconds:
				action === 'wait' ? (value.waitSeconds === undefined ? 10 : integer(value.waitSeconds, 1, 30)) : 0,
		};
	}
	if (definition.name === 'machine_docker_inspect' || definition.name === 'machine_docker_control') {
		const containerId = text(value.containerId, 64);
		if (!/^[a-f0-9]{64}$/.test(containerId)) {
			throw new AgentFailure('invalid_input');
		}
		if (definition.name === 'machine_docker_inspect') {
			return { kind: 'docker_inspect', connectionId, containerId };
		}
		const action = DOCKER_ACTIONS.find((item) => item === value.action);
		const expectedFingerprint = text(value.expectedFingerprint, 64);
		if (!action || !/^[a-f0-9]{64}$/.test(expectedFingerprint)) {
			throw new AgentFailure('invalid_input');
		}
		return { kind: 'docker_control', connectionId, containerId, action, expectedFingerprint };
	}
	const path = absolutePath(value.path, 4096);
	if (definition.mutation && (/[\u0000-\u001f\u007f]/u.test(path) || path === '/')) {
		throw new AgentFailure('invalid_input');
	}
	if (definition.name === 'file_inspect') {
		return { kind: 'inspect', connectionId, path };
	}
	if (definition.name === 'file_patch') {
		const expectedSha256 = text(value.expectedSha256, 64);
		const oldText = text(value.oldText, 4096);
		const newText = text(value.newText, 4096, true);
		if (!/^[a-f0-9]{64}$/.test(expectedSha256) || oldText === newText) {
			throw new AgentFailure('invalid_input');
		}
		return { kind: 'patch', connectionId, path, expectedSha256, oldText, newText };
	}
	if (definition.name === 'file_move' || definition.name === 'file_delete') {
		const expectedFingerprint = text(value.expectedFingerprint, 64);
		if (!/^[a-f0-9]{64}$/.test(expectedFingerprint)) {
			throw new AgentFailure('invalid_input');
		}
		if (definition.name === 'file_move') {
			const destinationPath = absolutePath(value.destinationPath, 256);
			if (
				destinationPath === '/' ||
				destinationPath === path ||
				destinationPath.startsWith(path + '/') ||
				path.startsWith(destinationPath + '/') ||
				/[\u0000-\u001f\u007f]/u.test(destinationPath)
			) {
				throw new AgentFailure('invalid_input');
			}
			return { kind: 'move', connectionId, path, destinationPath, expectedFingerprint };
		}
		if (value.scope !== 'entry' && value.scope !== 'tree') {
			throw new AgentFailure('invalid_input');
		}
		return { kind: 'delete', connectionId, path, expectedFingerprint, scope: value.scope };
	}
	if (definition.name === 'file_write') {
		const expectedSha256 = text(value.expectedSha256, 64);
		if (expectedSha256 !== 'absent' && !/^[a-f0-9]{64}$/.test(expectedSha256)) {
			throw new AgentFailure('invalid_input');
		}
		return { kind: 'write', connectionId, path, content: text(value.content, 8192, true), expectedSha256 };
	}
	if (definition.name === 'file_read') {
		return { kind: 'read', connectionId, path };
	}
	if (definition.name === 'file_list') {
		return { kind: 'list', connectionId, path };
	}
	if (definition.name !== 'file_search') {
		throw new AgentFailure('invalid_input');
	}
	const query = text(value.query, 1024);
	if (query.includes('\n') || query.includes('\r')) {
		throw new AgentFailure('invalid_input');
	}
	return {
		kind: 'search',
		connectionId,
		path,
		query,
		maxResults: value.maxResults === undefined ? 20 : integer(value.maxResults, 1, 100),
	};
}
