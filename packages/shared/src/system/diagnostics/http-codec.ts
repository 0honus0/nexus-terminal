import { record, integer, text, InvalidPayload } from '../../common/http-codec.js';
import {
	HOST_DIAGNOSTIC_MAX_RESPONSE_BYTES,
	HOST_DIAGNOSTIC_ERROR_CODES,
	DIAGNOSTIC_MODULE_IDS,
	DIAGNOSTIC_RESOURCE_UNITS,
	DIAGNOSTIC_RESOURCE_STATUSES,
	type DiagnosticResourceName,
} from './values.js';
import type { HostDiagnosticResponse } from './http.js';
import type { ModuleResourceView } from './model.js';

function nonNegativeNumber(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
		throw new InvalidPayload();
	}
	return value;
}

function readModules(value: unknown): ModuleResourceView[] {
	if (!Array.isArray(value) || value.length !== DIAGNOSTIC_MODULE_IDS.length) {
		throw new InvalidPayload();
	}
	const seen = new Set<string>();
	return value.map((item) => {
		const row = record(item, ['id', 'status', 'metrics']);
		const id = DIAGNOSTIC_MODULE_IDS.find((id) => id === row.id);
		const status = DIAGNOSTIC_RESOURCE_STATUSES.find((status) => status === row.status);
		if (
			!id ||
			seen.has(id) ||
			!status ||
			!Array.isArray(row.metrics) ||
			row.metrics.length > Object.keys(DIAGNOSTIC_RESOURCE_UNITS).length ||
			(status !== 'available' && row.metrics.length !== 0) ||
			(status === 'available' && row.metrics.length === 0)
		) {
			throw new InvalidPayload();
		}
		seen.add(id);
		const names = new Set<string>();
		return {
			id,
			status,
			metrics: row.metrics.map((item) => {
				const metric = record(item, ['name', 'unit', 'value']);
				const name = Object.keys(DIAGNOSTIC_RESOURCE_UNITS).find(
					(name): name is DiagnosticResourceName => name === metric.name,
				);
				if (!name || names.has(name) || metric.unit !== DIAGNOSTIC_RESOURCE_UNITS[name]) {
					throw new InvalidPayload();
				}
				names.add(name);
				return { name, unit: DIAGNOSTIC_RESOURCE_UNITS[name], value: integer(metric.value) };
			}),
		};
	});
}

export function readHostDiagnosticResponse(value: unknown): HostDiagnosticResponse {
	const r = record(record(value, ['diagnostics'], HOST_DIAGNOSTIC_MAX_RESPONSE_BYTES).diagnostics, [
		'collectedAt',
		'process',
		'database',
		'modules',
	]);
	const p = record(r.process, [
		'uptimeSeconds',
		'residentBytes',
		'heapUsedBytes',
		'runtimeVersion',
		'heapTotalBytes',
		'externalBytes',
		'arrayBufferBytes',
		'cpuUserSeconds',
		'cpuSystemSeconds',
		'gcCount',
		'gcDurationSeconds',
	]);
	const db = record(r.database, ['available', 'schemaVersion']);
	if (integer(p.heapUsedBytes) > integer(p.heapTotalBytes)) {
		throw new InvalidPayload();
	}
	if (typeof db.available !== 'boolean' || db.available !== (db.schemaVersion !== null)) {
		throw new InvalidPayload();
	}
	return {
		diagnostics: {
			collectedAt: integer(r.collectedAt),
			process: {
				uptimeSeconds: integer(p.uptimeSeconds),
				residentBytes: integer(p.residentBytes),
				heapUsedBytes: integer(p.heapUsedBytes),
				runtimeVersion: text(p.runtimeVersion, 64),
				heapTotalBytes: integer(p.heapTotalBytes),
				externalBytes: integer(p.externalBytes),
				arrayBufferBytes: integer(p.arrayBufferBytes),
				cpuUserSeconds: nonNegativeNumber(p.cpuUserSeconds),
				cpuSystemSeconds: nonNegativeNumber(p.cpuSystemSeconds),
				gcCount: integer(p.gcCount),
				gcDurationSeconds: nonNegativeNumber(p.gcDurationSeconds),
			},
			modules: readModules(r.modules),
			database: {
				available: db.available,
				schemaVersion: db.schemaVersion === null ? null : integer(db.schemaVersion),
			},
		},
	};
}

export function readHostDiagnosticError(value: unknown): { code: (typeof HOST_DIAGNOSTIC_ERROR_CODES)[number] } {
	const r = record(value, ['code']);
	const code = HOST_DIAGNOSTIC_ERROR_CODES.find((code) => code === r.code);
	if (!code) {
		throw new InvalidPayload();
	}
	return { code };
}
