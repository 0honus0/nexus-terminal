import type { LocalSystemStatus } from './model.js';
import {
	SYSTEM_STATUS_MAX_RESPONSE_BYTES,
	SYSTEM_HEALTH_STATUS,
	SYSTEM_SERVICE_NAME,
	SYSTEM_STATUS_ERROR_CODES,
} from './values.js';
import type { SystemHealthResponse, LocalSystemStatusError } from './http.js';

export class InvalidSystemStatusPayload extends Error {
	constructor() {
		super('invalid_system_status_payload');
	}
}

function number(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		throw new InvalidSystemStatusPayload();
	}
	return value;
}

function optionalNumber(value: unknown): number | undefined {
	return value === undefined ? undefined : number(value);
}

function text(value: unknown): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== 'string') {
		throw new InvalidSystemStatusPayload();
	}
	return value;
}

export function readSystemHealthResponse(value: unknown): SystemHealthResponse {
	if (
		value === null ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		!('status' in value) ||
		!('service' in value) ||
		Object.keys(value).length !== 2 ||
		!Object.hasOwn(value, 'status') ||
		!Object.hasOwn(value, 'service') ||
		value.status !== SYSTEM_HEALTH_STATUS ||
		value.service !== SYSTEM_SERVICE_NAME
	) {
		throw new InvalidSystemStatusPayload();
	}
	return { status: value.status, service: value.service };
}

export function readLocalSystemStatus(value: unknown): LocalSystemStatus {
	if (
		!value ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		new TextEncoder().encode(JSON.stringify(value)).length > SYSTEM_STATUS_MAX_RESPONSE_BYTES
	) {
		throw new InvalidSystemStatusPayload();
	}

	const keys = [
		'cpuPercent',
		'memPercent',
		'memUsed',
		'memTotal',
		'diskPercent',
		'diskUsed',
		'diskTotal',
		'cpuModel',
		'osName',
		'uptimeSeconds',
	];
	if (
		Object.keys(value).some((key) => !keys.includes(key)) ||
		!('cpuPercent' in value) ||
		!('memPercent' in value) ||
		!('memUsed' in value) ||
		!('memTotal' in value) ||
		!('uptimeSeconds' in value) ||
		['cpuPercent', 'memPercent', 'memUsed', 'memTotal', 'uptimeSeconds'].some((key) => !Object.hasOwn(value, key))
	) {
		throw new InvalidSystemStatusPayload();
	}
	return {
		cpuPercent: number(value.cpuPercent),
		memPercent: number(value.memPercent),
		memUsed: number(value.memUsed),
		memTotal: number(value.memTotal),
		diskPercent: 'diskPercent' in value ? optionalNumber(value.diskPercent) : undefined,
		diskUsed: 'diskUsed' in value ? optionalNumber(value.diskUsed) : undefined,
		diskTotal: 'diskTotal' in value ? optionalNumber(value.diskTotal) : undefined,
		cpuModel: 'cpuModel' in value ? text(value.cpuModel) : undefined,
		osName: 'osName' in value ? text(value.osName) : undefined,
		uptimeSeconds: number(value.uptimeSeconds),
	};
}

export function readLocalSystemStatusError(value: unknown): LocalSystemStatusError {
	if (
		value === null ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		Object.keys(value).length !== 1 ||
		!Object.hasOwn(value, 'code') ||
		!('code' in value)
	) {
		throw new InvalidSystemStatusPayload();
	}
	const code = SYSTEM_STATUS_ERROR_CODES.find((code) => code === value.code);
	if (!code) {
		throw new InvalidSystemStatusPayload();
	}
	return { code };
}
