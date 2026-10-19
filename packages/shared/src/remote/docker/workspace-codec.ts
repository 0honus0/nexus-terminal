import { DOCKER_MAX_CONTAINERS } from './values.js';
import { OBSERVATION_MAX_TEXT_BYTES, OBSERVATION_MAX_RESPONSE_BYTES } from '../monitoring/values.js';
import type {
	WorkspaceDockerStats,
	WorkspaceDockerStatus,
	WorkspaceDockerContainer,
	WorkspaceDockerPortBinding,
} from './workspace.js';
import { DOCKER_ACTIONS, DOCKER_MAX_IDENTIFIER_BYTES } from './values.js';
import type { WorkspaceDockerCommandRequest, WorkspaceDockerStatsRequest } from './workspace.js';

export class InvalidWorkspaceDockerPayload extends Error {
	constructor() {
		super('invalid_workspace_docker_payload');
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function budget(value: unknown): void {
	const json = JSON.stringify(value);
	if (json === undefined || new TextEncoder().encode(json).length > OBSERVATION_MAX_RESPONSE_BYTES) {
		throw new InvalidWorkspaceDockerPayload();
	}
}

function record(value: unknown, keys: string[]): Record<string, unknown> {
	if (!isRecord(value)) {
		throw new InvalidWorkspaceDockerPayload();
	}
	const row = value;
	if (Object.keys(row).some((key) => !keys.includes(key)) || keys.some((key) => !Object.hasOwn(row, key))) {
		throw new InvalidWorkspaceDockerPayload();
	}
	return row;
}

function id(value: unknown): string {
	if (
		typeof value !== 'string' ||
		value.length > DOCKER_MAX_IDENTIFIER_BYTES ||
		!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(value)
	) {
		throw new InvalidWorkspaceDockerPayload();
	}
	return value;
}

export function readWorkspaceDockerStats(value: unknown): WorkspaceDockerStatsRequest {
	const row = record(value, ['containerId']);
	return { containerId: id(row.containerId) };
}

export function readWorkspaceDockerCommand(value: unknown): WorkspaceDockerCommandRequest {
	const row = record(value, ['containerId', 'command']);
	const command = DOCKER_ACTIONS.find((action) => action === row.command);
	if (!command) {
		throw new InvalidWorkspaceDockerPayload();
	}
	return { containerId: id(row.containerId), command };
}

function responseRow(value: unknown, allowed: readonly string[], required: readonly string[]): Record<string, unknown> {
	if (!isRecord(value)) {
		throw new InvalidWorkspaceDockerPayload();
	}
	const result = value;
	if (
		Object.keys(result).some((key) => !allowed.includes(key)) ||
		required.some((key) => !Object.hasOwn(result, key))
	) {
		throw new InvalidWorkspaceDockerPayload();
	}
	return result;
}

function responseText(value: unknown): string {
	if (typeof value !== 'string' || new TextEncoder().encode(value).length > OBSERVATION_MAX_TEXT_BYTES) {
		throw new InvalidWorkspaceDockerPayload();
	}
	return value;
}

function responsePort(value: unknown): WorkspaceDockerPortBinding {
	const row = responseRow(value, ['ip', 'privatePort', 'publicPort', 'type'], ['privatePort', 'type']);
	const privatePort = row.privatePort,
		publicPort = row.publicPort;
	if (
		typeof privatePort !== 'number' ||
		!Number.isInteger(privatePort) ||
		privatePort < 1 ||
		privatePort > 65535 ||
		(publicPort !== undefined &&
			(typeof publicPort !== 'number' || !Number.isInteger(publicPort) || publicPort < 1 || publicPort > 65535))
	) {
		throw new InvalidWorkspaceDockerPayload();
	}
	return {
		ip: row.ip === undefined ? undefined : responseText(row.ip),
		privatePort,
		publicPort: typeof publicPort === 'number' ? publicPort : undefined,
		type: responseText(row.type),
	};
}

export function readWorkspaceDockerStatsResponse(value: unknown): WorkspaceDockerStats | null {
	budget(value);
	if (value === null) {
		return null;
	}
	const keys = ['id', 'name', 'cpuPercent', 'memoryUsage', 'memoryPercent', 'networkIo', 'blockIo', 'pids'];
	const row = responseRow(value, keys, keys);
	return {
		id: id(row.id),
		name: responseText(row.name),
		cpuPercent: responseText(row.cpuPercent),
		memoryUsage: responseText(row.memoryUsage),
		memoryPercent: responseText(row.memoryPercent),
		networkIo: responseText(row.networkIo),
		blockIo: responseText(row.blockIo),
		pids: responseText(row.pids),
	};
}

function responseContainer(value: unknown): WorkspaceDockerContainer {
	const keys = [
		'id',
		'names',
		'image',
		'imageId',
		'command',
		'created',
		'state',
		'status',
		'ports',
		'labels',
		'stats',
	];
	const row = responseRow(
		value,
		keys,
		keys.filter((key) => key !== 'stats'),
	);
	if (!Array.isArray(row.names) || row.names.length > 1024 || !Array.isArray(row.ports) || row.ports.length > 4096) {
		throw new InvalidWorkspaceDockerPayload();
	}
	const created = row.created;
	if (typeof created !== 'string' && (typeof created !== 'number' || !Number.isFinite(created) || created < 0)) {
		throw new InvalidWorkspaceDockerPayload();
	}
	let labels: string | Record<string, string>;
	if (typeof row.labels === 'string') {
		labels = responseText(row.labels);
	} else {
		const source = responseRow(
			row.labels,
			Object.keys(row.labels && typeof row.labels === 'object' ? row.labels : {}),
			[],
		);
		labels = Object.fromEntries(
			Object.entries(source).map(([key, value]) => [responseText(key), responseText(value)]),
		);
	}
	const stats = row.stats === undefined ? undefined : readWorkspaceDockerStatsResponse(row.stats);
	if (stats && stats.id !== row.id && stats.id !== id(row.id).slice(0, 12)) {
		throw new InvalidWorkspaceDockerPayload();
	}
	return {
		id: id(row.id),
		names: row.names.map(responseText),
		image: responseText(row.image),
		imageId: responseText(row.imageId),
		command: responseText(row.command),
		created: typeof created === 'string' ? responseText(created) : created,
		state: responseText(row.state),
		status: responseText(row.status),
		ports: row.ports.map(responsePort),
		labels,
		stats,
	};
}

export function readWorkspaceDockerStatusResponse(value: unknown): WorkspaceDockerStatus {
	budget(value);
	const row = responseRow(value, ['available', 'containers'], ['available', 'containers']);
	if (
		typeof row.available !== 'boolean' ||
		!Array.isArray(row.containers) ||
		row.containers.length > DOCKER_MAX_CONTAINERS ||
		(!row.available && row.containers.length)
	) {
		throw new InvalidWorkspaceDockerPayload();
	}
	const containers = row.containers.map(responseContainer);
	if (new Set(containers.map((row) => row.id)).size !== containers.length) {
		throw new InvalidWorkspaceDockerPayload();
	}
	return { available: row.available, containers };
}
