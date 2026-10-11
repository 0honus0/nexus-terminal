import type { SshResourceStatusPath } from './http.js';
import type { RemoteStatusSample, SshResourceStatus } from './model.js';
import {
	OBSERVATION_ERROR_CODES,
	OBSERVATION_MAX_RESPONSE_BYTES,
	OBSERVATION_MAX_TEXT_BYTES,
	OBSERVATION_MAX_RESOURCES,
} from './values.js';

export class InvalidObservationPayload extends Error {
	constructor() {
		super('invalid_observation_payload');
	}
}

function row(value: unknown, keys: readonly string[], required: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new InvalidObservationPayload();
	}
	const data = value as Record<string, unknown>;
	if (Object.keys(data).some((key) => !keys.includes(key)) || required.some((key) => !Object.hasOwn(data, key))) {
		throw new InvalidObservationPayload();
	}
	return data;
}

function number(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		throw new InvalidObservationPayload();
	}
	return value;
}

function text(value: unknown): string {
	if (typeof value !== 'string' || new TextEncoder().encode(value).length > OBSERVATION_MAX_TEXT_BYTES) {
		throw new InvalidObservationPayload();
	}
	return value;
}

function optionalNumber(value: unknown): number | undefined {
	return value === undefined ? undefined : number(value);
}

function optionalText(value: unknown): string | undefined {
	return value === undefined ? undefined : text(value);
}

export function readRemoteStatusSample(value: unknown): RemoteStatusSample {
	const data = row(
		value,
		[
			'cpuPercent',
			'memPercent',
			'memUsed',
			'memTotal',
			'swapPercent',
			'swapUsed',
			'swapTotal',
			'diskPercent',
			'diskUsed',
			'diskTotal',
			'netRxRate',
			'netTxRate',
			'cpuModel',
			'netInterface',
			'osName',
			'loadAvg',
			'timestamp',
		],
		['timestamp'],
	);
	let loadAvg: number[] | undefined;
	if (data.loadAvg !== undefined) {
		if (!Array.isArray(data.loadAvg) || data.loadAvg.length !== 3) {
			throw new InvalidObservationPayload();
		}
		loadAvg = data.loadAvg.map(number);
	}
	return {
		cpuPercent: optionalNumber(data.cpuPercent),
		memPercent: optionalNumber(data.memPercent),
		memUsed: optionalNumber(data.memUsed),
		memTotal: optionalNumber(data.memTotal),
		swapPercent: optionalNumber(data.swapPercent),
		swapUsed: optionalNumber(data.swapUsed),
		swapTotal: optionalNumber(data.swapTotal),
		diskPercent: optionalNumber(data.diskPercent),
		diskUsed: optionalNumber(data.diskUsed),
		diskTotal: optionalNumber(data.diskTotal),
		netRxRate: optionalNumber(data.netRxRate),
		netTxRate: optionalNumber(data.netTxRate),
		cpuModel: optionalText(data.cpuModel),
		netInterface: optionalText(data.netInterface),
		osName: optionalText(data.osName),
		loadAvg,
		timestamp: number(data.timestamp),
	};
}

export function readSshResourceStatus(value: unknown): SshResourceStatus {
	const data = row(
		value,
		['key', 'connectionId', 'name', 'username', 'host', 'port', 'status', 'error', 'checkedAt'],
		['key', 'connectionId', 'name', 'username', 'host', 'port', 'checkedAt'],
	);
	const connectionId = number(data.connectionId),
		port = number(data.port);
	if (
		!Number.isSafeInteger(connectionId) ||
		connectionId < 1 ||
		!Number.isSafeInteger(port) ||
		port < 1 ||
		port > 65535 ||
		(data.status === undefined) === (data.error === undefined)
	) {
		throw new InvalidObservationPayload();
	}
	const error = data.error === undefined ? undefined : OBSERVATION_ERROR_CODES.find((code) => code === data.error);
	if (data.error !== undefined && !error) {
		throw new InvalidObservationPayload();
	}
	if (data.status !== undefined) {
		return {
			key: text(data.key),
			connectionId,
			name: text(data.name),
			username: text(data.username),
			host: text(data.host),
			port,
			status: readRemoteStatusSample(data.status),
			checkedAt: number(data.checkedAt),
		};
	}
	if (!error) {
		throw new InvalidObservationPayload();
	}
	return {
		key: text(data.key),
		connectionId,
		name: text(data.name),
		username: text(data.username),
		host: text(data.host),
		port,
		error,
		checkedAt: number(data.checkedAt),
	};
}

export function readSshResourceStatusList(value: unknown): SshResourceStatus[] {
	if (
		!Array.isArray(value) ||
		value.length > OBSERVATION_MAX_RESOURCES ||
		new TextEncoder().encode(JSON.stringify(value)).length > OBSERVATION_MAX_RESPONSE_BYTES
	) {
		throw new InvalidObservationPayload();
	}
	const result = value.map(readSshResourceStatus);
	if (new Set(result.map((row) => row.key)).size !== result.length) {
		throw new InvalidObservationPayload();
	}
	return result;
}

export function readSshResourceStatusPath(value: unknown): SshResourceStatusPath {
	const data = row(value, ['connectionId'], ['connectionId']);
	if (typeof data.connectionId !== 'string' || !/^[1-9]\d*$/u.test(data.connectionId)) {
		throw new InvalidObservationPayload();
	}
	const connectionId = Number(data.connectionId);
	if (!Number.isSafeInteger(connectionId)) {
		throw new InvalidObservationPayload();
	}
	return { connectionId };
}
