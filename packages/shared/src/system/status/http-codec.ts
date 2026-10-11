import type { LocalSystemStatus } from './model.js';
import { SYSTEM_STATUS_MAX_RESPONSE_BYTES } from './values.js';

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

export function readLocalSystemStatus(value: unknown): LocalSystemStatus {
	if (
		!value ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		new TextEncoder().encode(JSON.stringify(value)).length > SYSTEM_STATUS_MAX_RESPONSE_BYTES
	) {
		throw new InvalidSystemStatusPayload();
	}
	const row = value as Record<string, unknown>;
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
		Object.keys(row).some((key) => !keys.includes(key)) ||
		['cpuPercent', 'memPercent', 'memUsed', 'memTotal', 'uptimeSeconds'].some((key) => !Object.hasOwn(row, key))
	) {
		throw new InvalidSystemStatusPayload();
	}
	return {
		cpuPercent: number(row.cpuPercent),
		memPercent: number(row.memPercent),
		memUsed: number(row.memUsed),
		memTotal: number(row.memTotal),
		diskPercent: optionalNumber(row.diskPercent),
		diskUsed: optionalNumber(row.diskUsed),
		diskTotal: optionalNumber(row.diskTotal),
		cpuModel: text(row.cpuModel),
		osName: text(row.osName),
		uptimeSeconds: number(row.uptimeSeconds),
	};
}
