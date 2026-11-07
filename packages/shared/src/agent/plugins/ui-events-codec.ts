import { AGENT_HTTP_ERROR_CODES } from '../values.js';
import { readAgentArtifactResponse } from '../artifacts/http-codec.js';
import { agentInteger, agentRecord, agentText, InvalidAgentPayload, readAgentId } from '../http-codec.js';
import { AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES } from './values.js';
import { AGENT_RUN_STATUSES } from '../runs/values.js';
import type {
	AgentPluginUiEnvironment,
	AgentPluginUiHostInput,
	AgentPluginUiHostResult,
	AgentPluginUiTask,
	AgentPluginUiCheckpoint,
	AgentPluginUiHostFailure,
	AgentPluginUiArtifactSelection,
	AgentPluginUiAnchor,
} from './ui-events.js';

function boolean(input: unknown): boolean {
	if (typeof input !== 'boolean') {
		throw new InvalidAgentPayload();
	}
	return input;
}

function text(input: unknown): string {
	if (input === '') {
		return '';
	}
	return agentText(input, AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES);
}

function ids(input: unknown): number[] {
	if (!Array.isArray(input)) {
		throw new InvalidAgentPayload();
	}
	const result = input.map((id) => agentInteger(id, 1));
	if (new Set(result).size !== result.length) {
		throw new InvalidAgentPayload();
	}
	return result;
}

function task(input: unknown): AgentPluginUiTask | null {
	if (input === null) {
		return null;
	}
	const row = agentRecord(
		input,
		['runId', 'threadTitle', 'locallyStarted', 'status', 'preview', 'blocked', 'failureMessage', 'failureKey'],
		AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES,
	);
	const status = AGENT_RUN_STATUSES.find((value) => value === row.status);
	if (status === undefined) {
		throw new InvalidAgentPayload();
	}
	return {
		runId: readAgentId(row.runId),
		threadTitle: text(row.threadTitle),
		locallyStarted: boolean(row.locallyStarted),
		status,
		preview: text(row.preview),
		blocked: boolean(row.blocked),
		failureMessage: text(row.failureMessage),
		failureKey: text(row.failureKey),
	};
}

export function readAgentPluginUiCheckpoint(input: unknown): AgentPluginUiCheckpoint {
	const row = agentRecord(input, ['version', 'valueJson'], AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES);
	return { version: agentInteger(row.version, 1), valueJson: text(row.valueJson) };
}

function selectionKeys(input: unknown): string[] {
	if (!Array.isArray(input)) {
		throw new InvalidAgentPayload();
	}
	const keys = input.map(readAgentId);
	if (new Set(keys).size !== keys.length) {
		throw new InvalidAgentPayload();
	}
	return keys;
}

function anchor(input: unknown): AgentPluginUiAnchor {
	const r = agentRecord(input, ['left', 'top', 'width', 'height']);

	const coordinate = (value: unknown): number => {
		if (typeof value !== 'number' || !Number.isFinite(value)) {
			throw new InvalidAgentPayload();
		}
		return value;
	};

	const width = coordinate(r.width);
	const height = coordinate(r.height);
	if (width < 0 || height < 0) {
		throw new InvalidAgentPayload();
	}
	return { left: coordinate(r.left), top: coordinate(r.top), width, height };
}

function selection(input: unknown): AgentPluginUiArtifactSelection {
	const r = agentRecord(input, ['key', 'id', 'name', 'version', 'sha256', 'mediaType', 'sizeBytes']);
	if (
		typeof r.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(r.sha256) ||
		typeof r.mediaType !== 'string' ||
		!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u.test(r.mediaType)
	) {
		throw new InvalidAgentPayload();
	}
	return {
		key: readAgentId(r.key),
		id: readAgentId(r.id),
		name: text(r.name),
		version: agentInteger(r.version, 1),
		sha256: r.sha256,
		mediaType: r.mediaType,
		sizeBytes: agentInteger(r.sizeBytes),
	};
}

export function readAgentPluginUiHostInput(input: unknown): AgentPluginUiHostInput {
	const type = agentRecord(
		input,
		Object.keys(input !== null && typeof input === 'object' ? input : {}),
		AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES,
	).kind;
	switch (type) {
		case 'checkpoint.save': {
			const r = agentRecord(input, ['kind', 'checkpoint'], AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES);
			return { kind: type, checkpoint: readAgentPluginUiCheckpoint(r.checkpoint) };
		}
		case 'targets.remember': {
			const r = agentRecord(input, ['kind', 'ids']);
			return { kind: type, ids: ids(r.ids) };
		}
		case 'feedback.notify': {
			const r = agentRecord(
				input,
				['kind', 'tone', 'message', 'duration'],
				AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES,
			);
			if (r.tone !== 'success' && r.tone !== 'error' && r.tone !== 'warning' && r.tone !== 'info') {
				throw new InvalidAgentPayload();
			}
			return {
				kind: type,
				tone: r.tone,
				message: text(r.message),
				duration: r.duration === null ? null : agentInteger(r.duration),
			};
		}
		case 'feedback.confirm': {
			const r = agentRecord(
				input,
				['kind', 'title', 'message', 'confirmText', 'cancelText', 'destructive'],
				AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES,
			);
			return {
				kind: type,
				title: text(r.title),
				message: text(r.message),
				confirmText: text(r.confirmText),
				cancelText: text(r.cancelText),
				destructive: boolean(r.destructive),
			};
		}
		case 'resources.close': {
			const r = agentRecord(input, ['kind', 'target']);
			const raw = agentRecord(
				r.target,
				Object.keys(r.target !== null && typeof r.target === 'object' ? r.target : {}),
			);
			if (raw.kind === 'app') {
				agentRecord(raw, ['kind']);
				return { kind: type, target: { kind: 'app' } };
			}
			const target = agentRecord(raw, ['kind', 'runId', 'sessionId']);
			if (target.kind !== 'session') {
				throw new InvalidAgentPayload();
			}
			return {
				kind: type,
				target: { kind: 'session', runId: readAgentId(target.runId), sessionId: readAgentId(target.sessionId) },
			};
		}
		case 'task.update': {
			const r = agentRecord(input, ['kind', 'task'], AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES);
			return { kind: type, task: task(r.task) };
		}
		case 'window.open': {
			agentRecord(input, ['kind']);
			return { kind: type };
		}
		case 'artifact.selection.open': {
			const r = agentRecord(input, ['kind', 'anchor', 'keys']);
			return { kind: type, anchor: anchor(r.anchor), keys: selectionKeys(r.keys) };
		}
		case 'artifact.selection.read': {
			const r = agentRecord(input, ['kind', 'keys']);
			return { kind: type, keys: selectionKeys(r.keys) };
		}
		case 'artifact.selection.attach': {
			const r = agentRecord(input, ['kind', 'key', 'threadId']);
			return { kind: type, key: readAgentId(r.key), threadId: readAgentId(r.threadId) };
		}
		case 'artifact.upload': {
			const r = agentRecord(input, ['kind', 'artifactId', 'expectedVersion']);
			return {
				kind: type,
				artifactId: readAgentId(r.artifactId),
				expectedVersion: agentInteger(r.expectedVersion, 1),
			};
		}
		case 'artifact.download': {
			const r = agentRecord(input, ['kind', 'artifactId']);
			return { kind: type, artifactId: readAgentId(r.artifactId) };
		}
		default:
			throw new InvalidAgentPayload();
	}
}

export function readAgentPluginUiEnvironment(input: unknown): AgentPluginUiEnvironment {
	const r = agentRecord(
		input,
		[
			'appId',
			'appVersion',
			'checkpoint',
			'active',
			'minimized',
			'compact',
			'executionEnabled',
			'resumeRevision',
			'locale',
			'dark',
			'themeVariables',
			'imagePreviewMaxMiB',
			'targets',
			'preferredTargetIds',
		],
		AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES,
	);
	if (
		!Array.isArray(r.themeVariables) ||
		!Array.isArray(r.targets) ||
		typeof r.imagePreviewMaxMiB !== 'number' ||
		!Number.isSafeInteger(r.imagePreviewMaxMiB) ||
		r.imagePreviewMaxMiB < 0
	) {
		throw new InvalidAgentPayload();
	}
	const targetIds = r.targets.map((input) =>
		agentInteger(agentRecord(input, ['id', 'name', 'host', 'username']).id, 1),
	);
	if (new Set(targetIds).size !== targetIds.length) {
		throw new InvalidAgentPayload();
	}
	return {
		appId: readAgentId(r.appId),
		appVersion: agentInteger(r.appVersion, 1),
		checkpoint: r.checkpoint === null ? null : readAgentPluginUiCheckpoint(r.checkpoint),
		active: boolean(r.active),
		minimized: boolean(r.minimized),
		compact: boolean(r.compact),
		executionEnabled: boolean(r.executionEnabled),
		resumeRevision: agentInteger(r.resumeRevision),
		locale: agentText(r.locale, AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES),
		dark: boolean(r.dark),
		imagePreviewMaxMiB: r.imagePreviewMaxMiB,
		themeVariables: r.themeVariables.map((input) => {
			const t = agentRecord(input, ['name', 'value']);
			if (typeof t.name !== 'string' || !/^--[a-zA-Z][a-zA-Z0-9-]*$/u.test(t.name)) {
				throw new InvalidAgentPayload();
			}
			return { name: t.name, value: text(t.value) };
		}),
		targets: r.targets.map((input) => {
			const t = agentRecord(input, ['id', 'name', 'host', 'username']);
			return { id: agentInteger(t.id, 1), name: text(t.name), host: text(t.host), username: text(t.username) };
		}),
		preferredTargetIds: ids(r.preferredTargetIds),
	};
}

export function readAgentPluginUiHostResult(
	input: unknown,
	request: AgentPluginUiHostInput,
	appId: string,
): AgentPluginUiHostResult {
	const r = agentRecord(
		input,
		Object.keys(input !== null && typeof input === 'object' ? input : {}),
		AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES,
	);
	if (r.kind !== request.kind) {
		throw new InvalidAgentPayload();
	}
	if (request.kind === 'feedback.confirm') {
		agentRecord(r, ['kind', 'confirmed']);
		return { kind: request.kind, confirmed: boolean(r.confirmed) };
	}
	if (request.kind === 'resources.close') {
		agentRecord(r, ['kind', 'closed']);
		return { kind: request.kind, closed: boolean(r.closed) };
	}
	if (request.kind === 'artifact.selection.open' || request.kind === 'artifact.selection.read') {
		agentRecord(r, ['kind', 'selections']);
		if (!Array.isArray(r.selections)) {
			throw new InvalidAgentPayload();
		}
		const selections = r.selections.map(selection);
		if (new Set(selections.map((item) => item.key)).size !== selections.length) {
			throw new InvalidAgentPayload();
		}
		if (
			request.kind === 'artifact.selection.read' &&
			(selections.length !== request.keys.length ||
				selections.some((item, index) => item.key !== request.keys[index]))
		) {
			throw new InvalidAgentPayload();
		}
		return { kind: request.kind, selections };
	}
	if (request.kind === 'artifact.selection.attach') {
		agentRecord(r, ['kind', 'selection']);
		const item = selection(r.selection);
		if (item.key !== request.key) {
			throw new InvalidAgentPayload();
		}
		return { kind: request.kind, selection: item };
	}
	if (request.kind === 'artifact.upload') {
		agentRecord(r, ['kind', 'result'], AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES);
		const result = readAgentArtifactResponse(r.result);
		if (
			result.artifact.id !== request.artifactId ||
			result.artifact.appId !== appId ||
			result.artifact.version <= request.expectedVersion ||
			result.artifact.status !== 'ready'
		) {
			throw new InvalidAgentPayload();
		}
		return { kind: request.kind, result };
	}
	agentRecord(r, ['kind', 'accepted']);
	if (r.accepted !== true) {
		throw new InvalidAgentPayload();
	}
	return { kind: request.kind, accepted: true };
}

export function readAgentPluginUiHostFailure(input: unknown): AgentPluginUiHostFailure {
	const r = agentRecord(input, ['code', 'outcome']);
	const code =
		r.code === 'request_failed' || r.code === 'protocol_failure' || r.code === 'cancelled'
			? r.code
			: AGENT_HTTP_ERROR_CODES.find((value) => value === r.code);
	if (
		code === undefined ||
		(r.outcome !== 'not_dispatched' && r.outcome !== 'confirmed' && r.outcome !== 'unknown')
	) {
		throw new InvalidAgentPayload();
	}
	return { code, outcome: r.outcome };
}
